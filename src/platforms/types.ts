export interface PRDetails {
  number: number;
  title: string;
  description: string;
  author: string;
  baseBranch: string;
  headBranch: string;
}

export interface PRFile {
  filename: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  patch?: string;
}

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type FindingCategory = 'bug' | 'security' | 'performance' | 'quality' | 'documentation' | 'architecture' | 'design' | 'testing';

export interface FileFinding {
  line: number;
  severity: FindingSeverity;
  category: FindingCategory;
  message: string;
  suggestion: string;
}

export interface CrossFileFinding {
  severity: FindingSeverity;
  category: FindingCategory;
  message: string;
  affectedFiles: string[];
}

export interface FileReviewResult {
  filename: string;
  findings: FileFinding[];
}

export interface CrossFileReviewResult {
  overallAssessment: string;
  findings: CrossFileFinding[];
  recommendations: string[];
}

export interface ExistingComment {
  id: number | string;
  body: string;
  path?: string;
  line?: number;
  isResolved?: boolean;
}

export interface CommentAction {
  type: 'create' | 'update' | 'resolve';
  existingCommentId?: number | string;
  path?: string;
  line?: number;
  body: string;
}

export interface PlatformAdapter {
  getPRDetails(prNumber: number): Promise<PRDetails>;
  getPRFiles(prNumber: number): Promise<PRFile[]>;
  getExistingBotComments(prNumber: number): Promise<ExistingComment[]>;
  postInlineComment(prNumber: number, path: string, line: number, body: string): Promise<void>;
  postGeneralComment(prNumber: number, body: string): Promise<void>;
  updateComment(commentId: number | string, body: string): Promise<void>;
  resolveComment(commentId: number | string): Promise<void>;
}
