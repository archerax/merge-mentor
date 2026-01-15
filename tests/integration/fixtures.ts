/**
 * Test fixtures for integration tests.
 * Provides realistic mock data for PR reviews.
 */

import type {
  CrossFileReviewResult,
  ExistingComment,
  FileReviewResult,
  PRDetails,
  PRFile,
} from "../../src/platforms/types.js";

/** Sample PR details for testing. */
export const samplePRDetails: PRDetails = {
  number: 42,
  title: "Add user authentication module",
  description: "This PR implements JWT-based authentication for the API.",
  author: "test-author",
  baseBranch: "main",
  headBranch: "feature/auth",
};

/** Sample PR files with realistic diffs. */
export const samplePRFiles: PRFile[] = [
  {
    filename: "src/auth/login.ts",
    status: "added",
    additions: 45,
    deletions: 0,
    sha: "abc123",
    patch: `@@ -0,0 +1,45 @@
+import { hash, compare } from 'bcrypt';
+import { sign } from 'jsonwebtoken';
+
+interface LoginRequest {
+  email: string;
+  password: string;
+}
+
+interface LoginResponse {
+  token: string;
+  expiresIn: number;
+}
+
+export async function login(request: LoginRequest): Promise<LoginResponse> {
+  const { email, password } = request;
+
+  // TODO: Add rate limiting
+  const user = await findUserByEmail(email);
+  if (!user) {
+    throw new Error('Invalid credentials');
+  }
+
+  const isValid = await compare(password, user.passwordHash);
+  if (!isValid) {
+    throw new Error('Invalid credentials');
+  }
+
+  const token = sign({ userId: user.id }, process.env.JWT_SECRET!, {
+    expiresIn: '1h',
+  });
+
+  return { token, expiresIn: 3600 };
+}
+
+async function findUserByEmail(email: string) {
+  // Simulated database lookup
+  return {
+    id: '123',
+    email,
+    passwordHash: 'hashed',
+  };
+}`,
  },
  {
    filename: "src/auth/middleware.ts",
    status: "added",
    additions: 28,
    deletions: 0,
    sha: "def456",
    patch: `@@ -0,0 +1,28 @@
+import { verify } from 'jsonwebtoken';
+
+export interface AuthenticatedRequest {
+  userId: string;
+}
+
+export function authMiddleware(req: any, res: any, next: any) {
+  const authHeader = req.headers.authorization;
+
+  if (!authHeader || !authHeader.startsWith('Bearer ')) {
+    return res.status(401).json({ error: 'Missing token' });
+  }
+
+  const token = authHeader.slice(7);
+
+  try {
+    const decoded = verify(token, process.env.JWT_SECRET!) as { userId: string };
+    req.userId = decoded.userId;
+    next();
+  } catch (error) {
+    return res.status(401).json({ error: 'Invalid token' });
+  }
+}`,
  },
  {
    filename: "README.md",
    status: "modified",
    additions: 5,
    deletions: 1,
    sha: "ghi789",
    patch: `@@ -10,6 +10,10 @@ A sample application.
 
 ## Features
 
-- Basic features
+- Basic features
+- User authentication
+  - JWT-based tokens
+  - Secure password hashing
+  - Middleware protection`,
  },
  {
    filename: "package-lock.json",
    status: "modified",
    additions: 500,
    deletions: 20,
    sha: "jkl012",
    patch: undefined, // Lock files typically don't have patches in review
  },
];

/** Sample file review results. */
export const sampleFileReviewResults: FileReviewResult[] = [
  {
    filename: "src/auth/login.ts",
    findings: [
      {
        line: 27,
        severity: "high",
        category: "security",
        message: "JWT secret is accessed directly from environment without validation",
        suggestion:
          "Add validation to ensure JWT_SECRET is defined at startup, or use a configuration module with proper error handling.",
      },
      {
        line: 17,
        severity: "medium",
        category: "quality",
        message: "TODO comment indicates missing rate limiting",
        suggestion:
          "Implement rate limiting before merging to prevent brute force attacks on the login endpoint.",
      },
    ],
  },
  {
    filename: "src/auth/middleware.ts",
    findings: [
      {
        line: 7,
        severity: "medium",
        category: "quality",
        message: "Using 'any' type for request, response, and next parameters",
        suggestion:
          "Use proper Express types: Request, Response, NextFunction from 'express' package.",
      },
      {
        line: 17,
        severity: "high",
        category: "security",
        message: "JWT secret accessed without validation",
        suggestion: "Use the same secure configuration pattern as recommended for login.ts.",
      },
    ],
  },
];

/** Sample cross-file review result. */
export const sampleCrossFileResult: CrossFileReviewResult = {
  overallAssessment:
    "The authentication module provides basic JWT functionality but has several security and code quality issues that should be addressed before merging.",
  findings: [
    {
      severity: "high",
      category: "security",
      message:
        "JWT secret handling is inconsistent and lacks validation across authentication files",
      affectedFiles: ["src/auth/login.ts", "src/auth/middleware.ts"],
    },
    {
      severity: "medium",
      category: "architecture",
      message: "Missing centralized configuration management for security-sensitive values",
      affectedFiles: ["src/auth/login.ts", "src/auth/middleware.ts"],
    },
  ],
  recommendations: [
    "Create a dedicated configuration module that validates all required environment variables at startup",
    "Add comprehensive error handling for authentication failures",
    "Consider implementing refresh tokens for better security",
    "Add unit tests for the authentication logic",
  ],
};

/** Sample existing bot comments. */
export const sampleExistingComments: ExistingComment[] = [
  {
    id: 1001,
    body: "[MergeMentor Bot]\n\n**Security Issue** (high): JWT secret accessed without validation",
    path: "src/auth/login.ts",
    line: 27,
    isResolved: false,
  },
];

/** Copilot CLI response for file review. */
export function createCopilotFileResponse(filename: string): string {
  const result = sampleFileReviewResults.find((r) => r.filename === filename);
  if (!result) {
    return JSON.stringify({ findings: [] });
  }
  return JSON.stringify({
    findings: result.findings.map((f) => ({
      line: f.line,
      severity: f.severity,
      category: f.category,
      message: f.message,
      suggestion: f.suggestion,
    })),
  });
}

/** Copilot CLI response for cross-file review. */
export function createCopilotCrossFileResponse(): string {
  return JSON.stringify({
    overall_assessment: sampleCrossFileResult.overallAssessment,
    findings: sampleCrossFileResult.findings.map((f) => ({
      severity: f.severity,
      category: f.category,
      message: f.message,
      affected_files: f.affectedFiles,
    })),
    recommendations: sampleCrossFileResult.recommendations,
  });
}

/** Create empty review response. */
export function createEmptyReviewResponse(): string {
  return JSON.stringify({
    findings: [],
  });
}

/** Create empty cross-file response. */
export function createEmptyCrossFileResponse(): string {
  return JSON.stringify({
    overall_assessment: "No significant issues found.",
    findings: [],
    recommendations: [],
  });
}
