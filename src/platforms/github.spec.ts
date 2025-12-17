import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubAdapter } from './github.js';
import type { Config } from '../config.js';

const mockOctokitInstance = {
  pulls: {
    get: vi.fn(),
    listFiles: vi.fn(),
    listReviewComments: vi.fn(),
    createReviewComment: vi.fn(),
    updateReviewComment: vi.fn(),
  },
  issues: {
    listComments: vi.fn(),
    createComment: vi.fn(),
    updateComment: vi.fn(),
  },
};

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    pulls = mockOctokitInstance.pulls;
    issues = mockOctokitInstance.issues;
  },
}));

function createTestConfig(): Config {
  return {
    platform: 'github',
    github: {
      token: 'test-token',
      owner: 'test-owner',
      repo: 'test-repo',
    },
    azure: {
      token: '',
      org: '',
      project: '',
      repo: '',
    },
    copilot: {
      maxRetries: 3,
      timeoutMs: 60000,
    },
    botCommentIdentifier: '<!-- PR-Bot -->',
  };
}

describe('GitHubAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPRDetails', () => {
    it('retrieves PR details successfully', async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          title: 'Test PR',
          body: 'Test description',
          user: { login: 'testuser' },
          base: { ref: 'main' },
          head: { ref: 'feature-branch' },
        },
      });

      const result = await adapter.getPRDetails(123);

      expect(result).toEqual({
        number: 123,
        title: 'Test PR',
        description: 'Test description',
        author: 'testuser',
        baseBranch: 'main',
        headBranch: 'feature-branch',
      });
      expect(mockOctokitInstance.pulls.get).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
      });
    });

    it('handles PR with null body', async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          title: 'Test PR',
          body: null,
          user: { login: 'testuser' },
          base: { ref: 'main' },
          head: { ref: 'feature' },
        },
      });

      const result = await adapter.getPRDetails(123);

      expect(result.description).toBe('');
    });

    it('handles PR with missing user', async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          title: 'Test PR',
          body: 'Description',
          user: null,
          base: { ref: 'main' },
          head: { ref: 'feature' },
        },
      });

      const result = await adapter.getPRDetails(123);

      expect(result.author).toBe('unknown');
    });
  });

  describe('getPRFiles', () => {
    it('retrieves PR files successfully', async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.listFiles.mockResolvedValue({
        data: [
          {
            filename: 'src/test.ts',
            status: 'modified',
            additions: 10,
            deletions: 5,
            patch: '@@ -1,3 +1,4 @@',
          },
          {
            filename: 'README.md',
            status: 'added',
            additions: 20,
            deletions: 0,
            patch: '@@ -0,0 +1,20 @@',
          },
        ],
      });

      const result = await adapter.getPRFiles(123);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        filename: 'src/test.ts',
        status: 'modified',
        additions: 10,
        deletions: 5,
        patch: '@@ -1,3 +1,4 @@',
      });
      expect(result[1]).toEqual({
        filename: 'README.md',
        status: 'added',
        additions: 20,
        deletions: 0,
        patch: '@@ -0,0 +1,20 @@',
      });
    });

    it('handles empty file list', async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.listFiles.mockResolvedValue({ data: [] });

      const result = await adapter.getPRFiles(123);

      expect(result).toEqual([]);
    });
  });

  describe('getExistingBotComments', () => {
    it('retrieves bot comments from reviews and issues', async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.listReviewComments.mockResolvedValue({
        data: [
          {
            id: 1,
            body: '<!-- PR-Bot -->\nReview comment',
            path: 'src/test.ts',
            line: 10,
          },
          {
            id: 2,
            body: 'Regular comment',
            path: 'src/other.ts',
            line: 5,
          },
        ],
      });
      mockOctokitInstance.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 3,
            body: '<!-- PR-Bot -->\nGeneral comment',
          },
          {
            id: 4,
            body: 'User comment',
          },
        ],
      });

      const result = await adapter.getExistingBotComments(123);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 1,
        body: '<!-- PR-Bot -->\nReview comment',
        path: 'src/test.ts',
        line: 10,
      });
      expect(result[1]).toEqual({
        id: 3,
        body: '<!-- PR-Bot -->\nGeneral comment',
      });
    });

    it('handles missing line in review comment', async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.listReviewComments.mockResolvedValue({
        data: [
          {
            id: 1,
            body: '<!-- PR-Bot -->\nComment',
            path: 'test.ts',
            line: null,
          },
        ],
      });
      mockOctokitInstance.issues.listComments.mockResolvedValue({ data: [] });

      const result = await adapter.getExistingBotComments(123);

      expect(result[0].line).toBeUndefined();
    });

    it('handles null body in issue comment', async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.listReviewComments.mockResolvedValue({ data: [] });
      mockOctokitInstance.issues.listComments.mockResolvedValue({
        data: [{ id: 1, body: null }],
      });

      const result = await adapter.getExistingBotComments(123);

      expect(result).toHaveLength(0);
    });
  });

  describe('postInlineComment', () => {
    it('posts inline comment successfully', async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.get.mockResolvedValue({
        data: { head: { sha: 'abc123' } },
      });
      mockOctokitInstance.pulls.createReviewComment.mockResolvedValue({});

      await adapter.postInlineComment(123, 'src/test.ts', 10, 'Fix this issue');

      expect(mockOctokitInstance.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        body: '<!-- PR-Bot -->\n\nFix this issue',
        commit_id: 'abc123',
        path: 'src/test.ts',
        line: 10,
      });
    });
  });

  describe('postGeneralComment', () => {
    it('posts general comment successfully', async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.issues.createComment.mockResolvedValue({});

      await adapter.postGeneralComment(123, 'Overall feedback');

      expect(mockOctokitInstance.issues.createComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        issue_number: 123,
        body: '<!-- PR-Bot -->\n\nOverall feedback',
      });
    });
  });

  describe('updateComment', () => {
    it('updates review comment successfully', async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.updateReviewComment.mockResolvedValue({});

      await adapter.updateComment(456, 'Updated message');

      expect(mockOctokitInstance.pulls.updateReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 456,
        body: '<!-- PR-Bot -->\n\nUpdated message',
      });
    });

    it('falls back to issue comment update when review update fails', async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.updateReviewComment.mockRejectedValue(new Error('Not found'));
      mockOctokitInstance.issues.updateComment.mockResolvedValue({});

      await adapter.updateComment(456, 'Updated message');

      expect(mockOctokitInstance.issues.updateComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 456,
        body: '<!-- PR-Bot -->\n\nUpdated message',
      });
    });

    it('handles string comment ID', async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.updateReviewComment.mockResolvedValue({});

      await adapter.updateComment('789', 'Message');

      expect(mockOctokitInstance.pulls.updateReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 789,
        body: '<!-- PR-Bot -->\n\nMessage',
      });
    });
  });

  describe('resolveComment', () => {
    it('resolves review comment successfully', async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.updateReviewComment.mockResolvedValue({});

      await adapter.resolveComment(456);

      expect(mockOctokitInstance.pulls.updateReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 456,
        body: '<!-- PR-Bot -->\n\n~~This issue has been resolved.~~',
      });
    });

    it('falls back to issue comment when review resolve fails', async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.updateReviewComment.mockRejectedValue(new Error('Not found'));
      mockOctokitInstance.issues.updateComment.mockResolvedValue({});

      await adapter.resolveComment(456);

      expect(mockOctokitInstance.issues.updateComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 456,
        body: '<!-- PR-Bot -->\n\n~~This issue has been resolved.~~',
      });
    });

    it('handles string comment ID', async () => {
      const adapter = new GitHubAdapter(createTestConfig());
      mockOctokitInstance.pulls.updateReviewComment.mockResolvedValue({});

      await adapter.resolveComment('789');

      expect(mockOctokitInstance.pulls.updateReviewComment).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 789,
        body: '<!-- PR-Bot -->\n\n~~This issue has been resolved.~~',
      });
    });
  });
});
