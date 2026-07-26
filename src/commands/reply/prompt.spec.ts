import { describe, expect, it } from "vitest";
import type { UnresolvedCommentThread } from "../../platforms/types.js";
import { buildReplyPrompt, type ReplyPromptInput } from "./prompt.js";

describe("reply prompt", () => {
  describe("buildReplyPrompt", () => {
    it("builds prompt with security preamble, thread comments, and code snippet", () => {
      const thread: UnresolvedCommentThread = {
        id: "thread-1",
        path: "src/utils/math.ts",
        line: 25,
        comments: [
          {
            id: "c1",
            author: "alice",
            body: "Should we handle division by zero here?",
            createdAt: "2026-07-26T10:00:00Z",
            isBot: false,
          },
          {
            id: "c2",
            author: "merge-mentor",
            body: "Good call out.",
            createdAt: "2026-07-26T10:05:00Z",
            isBot: true,
          },
        ],
      };

      const input: ReplyPromptInput = {
        filePath: "src/utils/math.ts",
        line: 25,
        codeSnippet:
          "function divide(a: number, b: number) {\n  if (b === 0) throw new Error();\n  return a / b;\n}",
        thread,
      };

      const prompt = buildReplyPrompt(input);

      expect(prompt).toContain("MERGE MENTOR SECURITY BOUNDARY");
      expect(prompt).toContain("file `src/utils/math.ts` at line 25");
      expect(prompt).toContain("### User (alice) [2026-07-26T10:00:00Z]");
      expect(prompt).toContain("Should we handle division by zero here?");
      expect(prompt).toContain("### Bot (Merge Mentor) [2026-07-26T10:05:00Z]");
      expect(prompt).toContain("Good call out.");
      expect(prompt).toContain("function divide(a: number, b: number)");
      expect(prompt).toContain("<untrusted-comment-thread>");
      expect(prompt).toContain("<untrusted-code-snippet>");
      expect(prompt).toContain('"shouldResolve": true');
    });

    it("formats comments properly when createdAt timestamp is missing", () => {
      const thread: UnresolvedCommentThread = {
        id: "thread-2",
        path: "src/main.ts",
        line: 1,
        comments: [
          {
            id: "c1",
            author: "bob",
            body: "Minor typo here",
            isBot: false,
          },
        ],
      };

      const input: ReplyPromptInput = {
        filePath: "src/main.ts",
        line: 1,
        codeSnippet: "const greeting = 'hello';",
        thread,
      };

      const prompt = buildReplyPrompt(input);

      expect(prompt).toContain("### User (bob)\nMinor typo here");
      expect(prompt).not.toContain("[undefined]");
    });
  });
});
