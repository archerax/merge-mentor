import type { AIProviderClient } from "../ai/types.js";

export type BuildPlatform = "github" | "azure";
export type FailureType =
  | "compilation"
  | "test"
  | "lint"
  | "dependency"
  | "infrastructure"
  | "timeout"
  | "unknown";

export interface BuildReference {
  readonly platform: BuildPlatform;
  readonly id: string;
  readonly ownerOrOrg: string;
  readonly repository: string;
  readonly project?: string;
}

export interface BuildSummary {
  readonly id: string;
  readonly name: string;
  readonly status: "completed" | "inProgress" | "unknown";
  readonly result: "failed" | "partiallySucceeded" | "succeeded" | "unknown";
  readonly sourceBranch?: string;
  readonly commitSha?: string;
  readonly webUrl?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface BuildLogChunk {
  readonly jobName?: string;
  readonly stageName?: string;
  readonly stepName?: string;
  readonly sequence?: number;
  readonly content: string;
  readonly isFailureCandidate: boolean;
}

export interface BuildAnalysisProvider {
  getBuildSummary(reference: BuildReference): Promise<BuildSummary>;
  getFailedLogs(reference: BuildReference): Promise<BuildLogChunk[]>;
}

export interface EvidenceBlock {
  readonly id: string;
  readonly category: FailureType;
  readonly confidence: number;
  readonly content: string;
  readonly jobName?: string;
  readonly sequence?: number;
}

export interface PreparedEvidence {
  readonly blocks: readonly EvidenceBlock[];
  readonly truncated: boolean;
  readonly redacted: boolean;
}

export interface BuildDiagnosis {
  readonly failureType: FailureType;
  readonly confidence: number;
  readonly summary: string;
  readonly rootCause: string;
  readonly evidence: readonly string[];
  readonly affectedFiles: readonly { path: string; line?: number; column?: number }[];
  readonly recommendations: readonly string[];
  readonly limitations: readonly string[];
}

export interface BuildAnalysisResult {
  readonly summary: BuildSummary;
  readonly evidence: PreparedEvidence;
  readonly diagnosis: BuildDiagnosis;
  readonly report: string;
}

export interface BuildAnalysisOptions {
  readonly maxLogBytes?: number;
  readonly aiProvider?: AIProviderClient;
}
