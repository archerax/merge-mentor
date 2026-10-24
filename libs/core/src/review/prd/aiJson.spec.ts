import { describe, expect, it } from "vitest";

import type { AIResponse } from "../../ai/types.js";
import { parseAIJson } from "./aiJson.js";

const response = (raw: string, parsed: unknown): AIResponse => ({ raw, parsed });

describe("parseAIJson", () => {
  it("returns an object payload as is", () => {
    expect(parseAIJson(response("", { a: 1 }))).toEqual({ a: 1 });
  });

  it("parses a payload the provider left as serialised JSON text", () => {
    expect(parseAIJson(response("", '{"findings":[]}'))).toEqual({ findings: [] });
  });

  it("falls back to the raw text when the string payload is not JSON", () => {
    expect(parseAIJson(response('{"a":2}', "not json"))).toEqual({ a: 2 });
  });

  it("falls back to the raw text when nothing was parsed", () => {
    expect(parseAIJson(response('```json\n{"a":3}\n```', null))).toEqual({ a: 3 });
  });

  it("returns undefined when no JSON can be found", () => {
    expect(parseAIJson(response("nothing", "still nothing"))).toBeUndefined();
  });
});
