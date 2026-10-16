import { describe, expect, it } from "vitest";

import { classifyStructuredOutputFailure } from "./structuredOutputError.js";

describe("classifyStructuredOutputFailure", () => {
  it("treats a schema-hint message as a permanent rejection", () => {
    expect(
      classifyStructuredOutputFailure({ message: "Unsupported response format for this model" })
    ).toEqual({ fallback: true, permanent: true });
  });

  it("treats a structured-output hint in the error name as permanent", () => {
    expect(
      classifyStructuredOutputFailure({ message: "nope", name: "ResponseSchemaError" })
    ).toEqual({ fallback: true, permanent: true });
  });

  it("treats a captured 4xx session error as a permanent rejection", () => {
    expect(
      classifyStructuredOutputFailure({ message: "Request failed" }, [
        { errorType: "query", statusCode: 400, message: "Bad Request" },
      ])
    ).toEqual({ fallback: true, permanent: true });
  });

  it("retries once but does not disable on a weak JSON-RPC invalid-request code", () => {
    for (const code of [-32700, -32602, -32600]) {
      expect(classifyStructuredOutputFailure({ message: "Invalid params", code })).toEqual({
        fallback: true,
        permanent: false,
      });
    }
  });

  it("ignores JSON-RPC server errors and other numeric codes", () => {
    for (const code of [-32603, -32000, -32099, 500]) {
      expect(classifyStructuredOutputFailure({ message: "Internal error", code })).toEqual({
        fallback: false,
        permanent: false,
      });
    }
  });

  it("does not fall back on timeouts, aborts, or disconnects", () => {
    for (const message of [
      "Timeout after 60000ms waiting for the structured response",
      "The requested run was aborted before a structured result was completed.",
      "Session disconnected while waiting for a structured response",
    ]) {
      expect(classifyStructuredOutputFailure({ message })).toEqual({
        fallback: false,
        permanent: false,
      });
    }
  });

  it("never masks auth, quota, rate-limit, or context-limit errors", () => {
    for (const errorType of [
      "authentication",
      "authorization",
      "quota",
      "rate_limit",
      "context_limit",
    ]) {
      expect(
        classifyStructuredOutputFailure({ message: "Invalid response format", code: -32602 }, [
          { errorType, statusCode: 400, message: "rejected" },
        ])
      ).toEqual({ fallback: false, permanent: false });
    }
  });

  it("returns no fallback for an unrelated transport error with no structured signal", () => {
    expect(classifyStructuredOutputFailure({ message: "network down" })).toEqual({
      fallback: false,
      permanent: false,
    });
    expect(classifyStructuredOutputFailure({ message: "socket hang up", name: "Error" })).toEqual({
      fallback: false,
      permanent: false,
    });
  });

  it("ignores string error codes (e.g. Node ENOENT)", () => {
    expect(classifyStructuredOutputFailure({ message: "no such file", code: "ENOENT" })).toEqual({
      fallback: false,
      permanent: false,
    });
  });
});
