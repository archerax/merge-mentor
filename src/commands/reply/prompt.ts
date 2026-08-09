import { buildSecurityPreamble, wrapUntrustedContent } from "../../ai/prompts/securityPreamble.js";
import type { UnresolvedCommentThread } from "../../platforms/types.js";

/** Inputs used to build the AI prompt for replying to a PR comment thread. */
export interface ReplyPromptInput {
  /** Path of the file the comment thread refers to. */
  readonly filePath: string;
  /** Line number in the file the comment thread is attached to. */
  readonly line: number;
  /** Local code snippet surrounding the target line at HEAD. */
  readonly codeSnippet: string;
  /** The unresolved comment thread being replied to. */
  readonly thread: UnresolvedCommentThread;
}

/** Structured JSON response expected from the AI provider for a reply. */
export interface ReplyResponseSchema {
  /** The reply message in markdown format. */
  readonly reply: string;
  /** Whether the code at HEAD shows the discussed defect is resolved. */
  readonly shouldResolve: boolean;
}

/**
 * Builds the structured AI prompt for replying to a PR comment thread.
 */
export function buildReplyPrompt(input: ReplyPromptInput): string {
  const securityPreamble = buildSecurityPreamble();

  const formattedComments = input.thread.comments
    .map((c) => {
      const role = c.isBot ? "Bot (Merge Mentor)" : `User (${c.author})`;
      const timestamp = c.createdAt ? ` [${c.createdAt}]` : "";
      return `### ${role}${timestamp}\n${c.body}`;
    })
    .join("\n\n");

  const wrappedComments = wrapUntrustedContent("untrusted-comment-thread", formattedComments);

  const wrappedSnippet = wrapUntrustedContent("untrusted-code-snippet", input.codeSnippet);

  return `${securityPreamble}
You are an AI assistant helping a software development team review and resolve PR feedback.

Below is a comment thread on file \`${input.filePath}\` at line ${input.line}, followed by the latest code context at HEAD.

${wrappedComments}

${wrappedSnippet}

### Instructions:
1. Analyze the comment thread and the local code context at HEAD surrounding line ${input.line}.
2. Formulate a polite, technical, and helpful reply to the developer's latest comment.
3. Determine whether the defect or feedback discussed in the comment thread has been fixed or addressed in the code snippet at HEAD. Set \`shouldResolve\` to \`true\` if the code shows the issue is resolved, or \`false\` if further changes or discussion are required.
4. Return ONLY a single valid JSON object strictly matching this format:

{
  "reply": "Your explanation or reply message in markdown format",
  "shouldResolve": true
}
`;
}
