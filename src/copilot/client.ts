import { spawn } from 'child_process';
import type { FileReviewResult, CrossFileReviewResult, FileFinding, CrossFileFinding } from '../platforms/types.js';

export interface CopilotResponse {
  raw: string;
  parsed: unknown;
}

export class CopilotClient {
  private maxRetries: number;
  private timeoutMs: number;

  constructor(options?: { maxRetries?: number; timeoutMs?: number }) {
    this.maxRetries = options?.maxRetries ?? 3;
    this.timeoutMs = options?.timeoutMs ?? 60000;
  }

  async executePrompt(prompt: string): Promise<CopilotResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const raw = await this.runCopilotCli(prompt);
        const parsed = this.parseJsonResponse(raw);
        return { raw, parsed };
      } catch (error) {
        lastError = error as Error;
        if (attempt < this.maxRetries - 1) {
          await this.delay(1000 * (attempt + 1)); // Exponential backoff
        }
      }
    }

    throw new Error(`Copilot CLI failed after ${this.maxRetries} attempts: ${lastError?.message}`);
  }

  private runCopilotCli(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const errorChunks: Buffer[] = [];

      const proc = spawn('copilot', ['-p', prompt], {
        stdio: ['inherit', 'pipe', 'pipe'],
        timeout: this.timeoutMs,
      });

      proc.stdout?.on('data', (data: Buffer) => chunks.push(data));
      proc.stderr?.on('data', (data: Buffer) => errorChunks.push(data));

      proc.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('Copilot CLI is not installed or not in PATH. Please install GitHub Copilot CLI.'));
        } else {
          reject(error);
        }
      });

      proc.on('close', (code) => {
        const stdout = Buffer.concat(chunks).toString('utf-8');
        const stderr = Buffer.concat(errorChunks).toString('utf-8');

        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Copilot CLI exited with code ${code}: ${stderr || stdout}`));
        }
      });
    });
  }

  private parseJsonResponse(raw: string): unknown {
    // Try to extract JSON from the response
    // Copilot might include text before/after the JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Copilot response');
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      throw new Error(`Failed to parse JSON from Copilot response: ${(error as Error).message}`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  parseFileReview(filename: string, response: CopilotResponse): FileReviewResult {
    const data = response.parsed as { findings?: unknown[] };
    const findings: FileFinding[] = [];

    if (Array.isArray(data.findings)) {
      for (const f of data.findings) {
        const finding = f as Record<string, unknown>;
        findings.push({
          line: typeof finding.line === 'number' ? finding.line : 0,
          severity: this.validateSeverity(finding.severity),
          category: this.validateCategory(finding.category),
          message: String(finding.message || ''),
          suggestion: String(finding.suggestion || ''),
        });
      }
    }

    return { filename, findings };
  }

  parseCrossFileReview(response: CopilotResponse): CrossFileReviewResult {
    const data = response.parsed as {
      overall_assessment?: string;
      findings?: unknown[];
      recommendations?: unknown[];
    };

    const findings: CrossFileFinding[] = [];

    if (Array.isArray(data.findings)) {
      for (const f of data.findings) {
        const finding = f as Record<string, unknown>;
        findings.push({
          severity: this.validateSeverity(finding.severity),
          category: this.validateCrossFileCategory(finding.category),
          message: String(finding.message || ''),
          affectedFiles: Array.isArray(finding.affected_files)
            ? finding.affected_files.map(String)
            : [],
        });
      }
    }

    return {
      overallAssessment: String(data.overall_assessment || 'Review completed'),
      findings,
      recommendations: Array.isArray(data.recommendations)
        ? data.recommendations.map(String)
        : [],
    };
  }

  private validateSeverity(value: unknown): FileFinding['severity'] {
    const valid = ['critical', 'high', 'medium', 'low'];
    return valid.includes(String(value)) ? (String(value) as FileFinding['severity']) : 'medium';
  }

  private validateCategory(value: unknown): FileFinding['category'] {
    const valid = ['bug', 'security', 'performance', 'quality', 'documentation'];
    return valid.includes(String(value)) ? (String(value) as FileFinding['category']) : 'quality';
  }

  private validateCrossFileCategory(value: unknown): CrossFileFinding['category'] {
    const valid = ['architecture', 'design', 'testing', 'documentation', 'bug', 'security', 'performance', 'quality'];
    return valid.includes(String(value)) ? (String(value) as CrossFileFinding['category']) : 'design';
  }
}
