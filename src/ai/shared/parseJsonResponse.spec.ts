import { describe, expect, it } from "vitest";
import { JsonParseError } from "../../errors/index.js";
import { parseJsonResponse } from "./parseJsonResponse.js";

describe("parseJsonResponse", () => {
  it("should parse JSON from a ```json code block", () => {
    const raw = 'Some text\n```json\n{"key": "value"}\n```\nmore text';

    const result = parseJsonResponse(raw);

    expect(result).toEqual({ key: "value" });
  });

  it("should fall back to bare JSON regex when markdown block fails parsing", () => {
    const raw = 'Prefix text\n{"fallback": "ok"}\nSuffix text';

    const result = parseJsonResponse(raw);

    expect(result).toEqual({ fallback: "ok" });
  });

  it("should parse bare JSON object", () => {
    const result = parseJsonResponse('{"a": 1, "b": 2}');

    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("should throw JsonParseError when no JSON is found", () => {
    expect(() => parseJsonResponse("This is not JSON at all")).toThrow(JsonParseError);
    expect(() => parseJsonResponse("This is not JSON at all")).toThrow(
      "No JSON object found in response"
    );
  });

  it("should throw JsonParseError for malformed JSON", () => {
    expect(() => parseJsonResponse('{"a": broken}')).toThrow(JsonParseError);
  });
});
