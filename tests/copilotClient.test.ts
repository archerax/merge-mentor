import { describe, it, expect } from 'vitest';
import { CopilotClient, type CopilotResponse } from '../src/copilot/client.js';

function createCopilotClient(): CopilotClient {
  return new CopilotClient({ maxRetries: 1, timeoutMs: 5000 });
}

function createCopilotResponse(parsed: unknown): CopilotResponse {
  return { raw: JSON.stringify(parsed), parsed };
}

describe('CopilotClient', () => {
  describe('parseFileReview', () => {
    it('should parse valid file review response', () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [
          {
            line: 10,
            severity: 'high',
            category: 'bug',
            message: 'Potential null pointer',
            suggestion: 'Add null check',
          },
        ],
      });

      const result = client.parseFileReview('test.ts', response);

      expect(result.filename).toBe('test.ts');
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toEqual({
        line: 10,
        severity: 'high',
        category: 'bug',
        message: 'Potential null pointer',
        suggestion: 'Add null check',
      });
    });

    it('should handle empty findings', () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({ findings: [] });

      const result = client.parseFileReview('test.ts', response);

      expect(result.filename).toBe('test.ts');
      expect(result.findings).toHaveLength(0);
    });

    it('should handle missing findings array', () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({});

      const result = client.parseFileReview('test.ts', response);

      expect(result.filename).toBe('test.ts');
      expect(result.findings).toHaveLength(0);
    });

    it('should use default severity for invalid values', () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [
          { line: 1, severity: 'invalid', category: 'bug', message: 'test', suggestion: 'fix' },
        ],
      });

      const result = client.parseFileReview('test.ts', response);

      expect(result.findings[0].severity).toBe('medium');
    });

    it('should use default category for invalid values', () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [
          { line: 1, severity: 'high', category: 'invalid', message: 'test', suggestion: 'fix' },
        ],
      });

      const result = client.parseFileReview('test.ts', response);

      expect(result.findings[0].category).toBe('quality');
    });

    it('should handle missing line number', () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [
          { severity: 'high', category: 'bug', message: 'test', suggestion: 'fix' },
        ],
      });

      const result = client.parseFileReview('test.ts', response);

      expect(result.findings[0].line).toBe(0);
    });
  });

  describe('parseCrossFileReview', () => {
    it('should parse valid cross-file review response', () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        overall_assessment: 'Good PR overall',
        findings: [
          {
            severity: 'medium',
            category: 'architecture',
            message: 'Consider separating concerns',
            affected_files: ['src/a.ts', 'src/b.ts'],
          },
        ],
        recommendations: ['Add more tests', 'Update docs'],
      });

      const result = client.parseCrossFileReview(response);

      expect(result.overallAssessment).toBe('Good PR overall');
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toEqual({
        severity: 'medium',
        category: 'architecture',
        message: 'Consider separating concerns',
        affectedFiles: ['src/a.ts', 'src/b.ts'],
      });
      expect(result.recommendations).toEqual(['Add more tests', 'Update docs']);
    });

    it('should handle empty response', () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({});

      const result = client.parseCrossFileReview(response);

      expect(result.overallAssessment).toBe('Review completed');
      expect(result.findings).toHaveLength(0);
      expect(result.recommendations).toHaveLength(0);
    });

    it('should handle missing affected_files', () => {
      const client = createCopilotClient();
      const response = createCopilotResponse({
        findings: [
          { severity: 'low', category: 'design', message: 'test' },
        ],
      });

      const result = client.parseCrossFileReview(response);

      expect(result.findings[0].affectedFiles).toEqual([]);
    });
  });
});
