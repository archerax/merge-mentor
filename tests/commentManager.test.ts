import { describe, it, expect } from 'vitest';
import { CommentManager } from '../src/review/commentManager.js';
import type { ExistingComment, FileReviewResult, CrossFileReviewResult } from '../src/platforms/types.js';

describe('CommentManager', () => {
  const manager = new CommentManager('[AI Code Review Bot]');

  describe('formatInlineComment', () => {
    it('should format finding with correct severity emoji', () => {
      const result = manager.formatInlineComment({
        line: 10,
        severity: 'critical',
        category: 'security',
        message: 'SQL injection vulnerability',
        suggestion: 'Use parameterized queries',
      });

      expect(result).toContain('🔴');
      expect(result).toContain('**CRITICAL**');
      expect(result).toContain('security');
      expect(result).toContain('SQL injection vulnerability');
      expect(result).toContain('Use parameterized queries');
    });

    it('should use correct emoji for each severity', () => {
      const severities = [
        { severity: 'critical', emoji: '🔴' },
        { severity: 'high', emoji: '🟠' },
        { severity: 'medium', emoji: '🟡' },
        { severity: 'low', emoji: '🟢' },
      ] as const;

      for (const { severity, emoji } of severities) {
        const result = manager.formatInlineComment({
          line: 1,
          severity,
          category: 'bug',
          message: 'test',
          suggestion: 'fix',
        });
        expect(result).toContain(emoji);
      }
    });
  });

  describe('formatSummaryComment', () => {
    it('should include overview section', () => {
      const fileResults: FileReviewResult[] = [];
      const crossFileResult: CrossFileReviewResult = {
        overallAssessment: 'This PR looks good',
        findings: [],
        recommendations: [],
      };

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain('# 📋 Code Review Summary');
      expect(result).toContain('## Overview');
      expect(result).toContain('This PR looks good');
    });

    it('should include statistics', () => {
      const fileResults: FileReviewResult[] = [
        {
          filename: 'file1.ts',
          findings: [
            { line: 1, severity: 'critical', category: 'bug', message: 'bug1', suggestion: '' },
            { line: 2, severity: 'high', category: 'security', message: 'sec1', suggestion: '' },
          ],
        },
        {
          filename: 'file2.ts',
          findings: [
            { line: 5, severity: 'medium', category: 'performance', message: 'perf1', suggestion: '' },
          ],
        },
      ];
      const crossFileResult: CrossFileReviewResult = {
        overallAssessment: 'Needs work',
        findings: [],
        recommendations: [],
      };

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain('**Files Reviewed:** 2');
      expect(result).toContain('**Total Issues Found:** 3');
    });

    it('should count by severity correctly', () => {
      const fileResults: FileReviewResult[] = [
        {
          filename: 'test.ts',
          findings: [
            { line: 1, severity: 'critical', category: 'bug', message: '', suggestion: '' },
            { line: 2, severity: 'critical', category: 'bug', message: '', suggestion: '' },
            { line: 3, severity: 'high', category: 'bug', message: '', suggestion: '' },
            { line: 4, severity: 'medium', category: 'bug', message: '', suggestion: '' },
            { line: 5, severity: 'low', category: 'bug', message: '', suggestion: '' },
          ],
        },
      ];
      const crossFileResult: CrossFileReviewResult = {
        overallAssessment: '',
        findings: [],
        recommendations: [],
      };

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain('| 🔴 Critical | 2 |');
      expect(result).toContain('| 🟠 High | 1 |');
      expect(result).toContain('| 🟡 Medium | 1 |');
      expect(result).toContain('| 🟢 Low | 1 |');
    });

    it('should include cross-file findings when present', () => {
      const fileResults: FileReviewResult[] = [];
      const crossFileResult: CrossFileReviewResult = {
        overallAssessment: 'Review complete',
        findings: [
          {
            severity: 'high',
            category: 'architecture',
            message: 'Circular dependency detected',
            affectedFiles: ['a.ts', 'b.ts'],
          },
        ],
        recommendations: [],
      };

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain('## Cross-File Findings');
      expect(result).toContain('ARCHITECTURE');
      expect(result).toContain('Circular dependency detected');
      expect(result).toContain('a.ts, b.ts');
    });

    it('should include recommendations when present', () => {
      const fileResults: FileReviewResult[] = [];
      const crossFileResult: CrossFileReviewResult = {
        overallAssessment: 'Good',
        findings: [],
        recommendations: ['Add unit tests', 'Update documentation'],
      };

      const result = manager.formatSummaryComment(fileResults, crossFileResult);

      expect(result).toContain('## Recommendations');
      expect(result).toContain('- Add unit tests');
      expect(result).toContain('- Update documentation');
    });
  });

  describe('determineActions', () => {
    it('should create new comments for new findings', () => {
      const existingComments: ExistingComment[] = [];
      const fileResults: FileReviewResult[] = [
        {
          filename: 'test.ts',
          findings: [
            { line: 10, severity: 'high', category: 'bug', message: 'Bug found', suggestion: 'Fix it' },
          ],
        },
      ];
      const crossFileResult: CrossFileReviewResult = {
        overallAssessment: 'Needs work',
        findings: [],
        recommendations: [],
      };

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const createActions = actions.filter(a => a.type === 'create');
      expect(createActions).toHaveLength(2); // 1 inline + 1 summary
      expect(createActions[0].path).toBe('test.ts');
      expect(createActions[0].line).toBe(10);
    });

    it('should resolve comments that are no longer relevant', () => {
      const existingComments: ExistingComment[] = [
        { id: 1, body: '[AI Code Review Bot]\n\nbug issue', path: 'test.ts', line: 10 },
      ];
      const fileResults: FileReviewResult[] = []; // No findings
      const crossFileResult: CrossFileReviewResult = {
        overallAssessment: 'All good',
        findings: [],
        recommendations: [],
      };

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const resolveActions = actions.filter(a => a.type === 'resolve');
      expect(resolveActions).toHaveLength(1);
      expect(resolveActions[0].existingCommentId).toBe(1);
    });

    it('should not resolve already resolved comments', () => {
      const existingComments: ExistingComment[] = [
        { id: 1, body: '[AI Code Review Bot]\n\nbug issue', path: 'test.ts', line: 10, isResolved: true },
      ];
      const fileResults: FileReviewResult[] = [];
      const crossFileResult: CrossFileReviewResult = {
        overallAssessment: 'Good',
        findings: [],
        recommendations: [],
      };

      const actions = manager.determineActions(existingComments, fileResults, crossFileResult);

      const resolveActions = actions.filter(a => a.type === 'resolve');
      expect(resolveActions).toHaveLength(0);
    });

    it('should always create a summary comment', () => {
      const actions = manager.determineActions(
        [],
        [],
        { overallAssessment: 'Good', findings: [], recommendations: [] }
      );

      const summaryActions = actions.filter(a => a.type === 'create' && !a.path);
      expect(summaryActions).toHaveLength(1);
      expect(summaryActions[0].body).toContain('Code Review Summary');
    });
  });
});
