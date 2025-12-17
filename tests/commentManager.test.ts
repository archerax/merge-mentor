import { describe, it, expect, test } from 'vitest';
import { CommentManager } from '../src/review/commentManager.js';
import type { ExistingComment, FileReviewResult, CrossFileReviewResult, FileFinding } from '../src/platforms/types.js';

function createCommentManager(): CommentManager {
  return new CommentManager('[AI Code Review Bot]');
}

function createFileFinding(overrides: Partial<FileFinding> = {}): FileFinding {
  return {
    line: 10,
    severity: 'high',
    category: 'bug',
    message: 'Test message',
    suggestion: 'Test suggestion',
    ...overrides,
  };
}

function createCrossFileResult(overrides: Partial<CrossFileReviewResult> = {}): CrossFileReviewResult {
  return {
    overallAssessment: 'Test assessment',
    findings: [],
    recommendations: [],
    ...overrides,
  };
}

describe('CommentManager', () => {
  describe('formatInlineComment', () => {
    it('should format finding with correct severity emoji', () => {
      const manager = createCommentManager();
      const finding = createFileFinding({
        severity: 'critical',
        category: 'security',
        message: 'SQL injection vulnerability',
        suggestion: 'Use parameterized queries',
      });

      const result = manager.formatInlineComment(finding);

      expect(result).toContain('🔴');
      expect(result).toContain('**CRITICAL**');
      expect(result).toContain('security');
      expect(result).toContain('SQL injection vulnerability');
      expect(result).toContain('Use parameterized queries');
    });

    test.each([
      ['critical', '🔴'],
      ['high', '🟠'],
      ['medium', '🟡'],
      ['low', '🟢'],
    ] as const)('should use %s emoji for %s severity', (severity, emoji) => {
      const manager = createCommentManager();
      const finding = createFileFinding({ severity });

      const result = manager.formatInlineComment(finding);

      expect(result).toContain(emoji);
    });
  });

  describe('formatSummaryComment', () => {
    it('should include overview section', () => {
      const manager = createCommentManager();
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult({
        overallAssessment: 'This PR looks good',
      });

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain('# 📋 Code Review Summary');
      expect(result).toContain('## Overview');
      expect(result).toContain('This PR looks good');
    });

    it('should include statistics', () => {
      const manager = createCommentManager();
      const fileResults: FileReviewResult[] = [
        {
          filename: 'file1.ts',
          findings: [
            createFileFinding({ line: 1, severity: 'critical', category: 'bug' }),
            createFileFinding({ line: 2, severity: 'high', category: 'security' }),
          ],
        },
        {
          filename: 'file2.ts',
          findings: [
            createFileFinding({ line: 5, severity: 'medium', category: 'performance' }),
          ],
        },
      ];
      const crossFileResult = createCrossFileResult({ overallAssessment: 'Needs work' });

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain('**Files Reviewed:** 2');
      expect(result).toContain('**Total Issues Found:** 3');
    });

    it('should count by severity correctly', () => {
      const manager = createCommentManager();
      const fileResults: FileReviewResult[] = [
        {
          filename: 'test.ts',
          findings: [
            createFileFinding({ line: 1, severity: 'critical' }),
            createFileFinding({ line: 2, severity: 'critical' }),
            createFileFinding({ line: 3, severity: 'high' }),
            createFileFinding({ line: 4, severity: 'medium' }),
            createFileFinding({ line: 5, severity: 'low' }),
          ],
        },
      ];
      const crossFileResult = createCrossFileResult();

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain('| 🔴 Critical | 2 |');
      expect(result).toContain('| 🟠 High | 1 |');
      expect(result).toContain('| 🟡 Medium | 1 |');
      expect(result).toContain('| 🟢 Low | 1 |');
    });

    it('should include cross-file findings when present', () => {
      const manager = createCommentManager();
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult({
        overallAssessment: 'Review complete',
        findings: [
          {
            severity: 'high',
            category: 'architecture',
            message: 'Circular dependency detected',
            affectedFiles: ['a.ts', 'b.ts'],
          },
        ],
      });

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain('## Cross-File Findings');
      expect(result).toContain('ARCHITECTURE');
      expect(result).toContain('Circular dependency detected');
      expect(result).toContain('a.ts, b.ts');
    });

    it('should include recommendations when present', () => {
      const manager = createCommentManager();
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult({
        recommendations: ['Add unit tests', 'Update documentation'],
      });

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain('## Recommendations');
      expect(result).toContain('- Add unit tests');
      expect(result).toContain('- Update documentation');
    });
  });

  describe('determineActions', () => {
    it('should create new comments for new findings', () => {
      const manager = createCommentManager();
      const existingComments: ExistingComment[] = [];
      const fileResults: FileReviewResult[] = [
        {
          filename: 'test.ts',
          findings: [createFileFinding({ line: 10, message: 'Bug found', suggestion: 'Fix it' })],
        },
      ];
      const crossFileResult = createCrossFileResult({ overallAssessment: 'Needs work' });

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const createActions = actions.filter(a => a.type === 'create');
      expect(createActions).toHaveLength(2); // 1 inline + 1 summary
      expect(createActions[0].path).toBe('test.ts');
      expect(createActions[0].line).toBe(10);
    });

    it('should resolve comments that are no longer relevant', () => {
      const manager = createCommentManager();
      const existingComments: ExistingComment[] = [
        { id: 1, body: '[AI Code Review Bot]\n\nbug issue', path: 'test.ts', line: 10 },
      ];
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult({ overallAssessment: 'All good' });

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const resolveActions = actions.filter(a => a.type === 'resolve');
      expect(resolveActions).toHaveLength(1);
      expect(resolveActions[0].existingCommentId).toBe(1);
    });

    it('should not resolve already resolved comments', () => {
      const manager = createCommentManager();
      const existingComments: ExistingComment[] = [
        { id: 1, body: '[AI Code Review Bot]\n\nbug issue', path: 'test.ts', line: 10, isResolved: true },
      ];
      const fileResults: FileReviewResult[] = [];
      const crossFileResult = createCrossFileResult();

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const resolveActions = actions.filter(a => a.type === 'resolve');
      expect(resolveActions).toHaveLength(0);
    });

    it('should always create a summary comment', () => {
      const manager = createCommentManager();
      const actions = manager.determineActions([], [], createCrossFileResult());

      const summaryActions = actions.filter(a => a.type === 'create' && !a.path);
      expect(summaryActions).toHaveLength(1);
      expect(summaryActions[0].body).toContain('Code Review Summary');
    });
  });
});
