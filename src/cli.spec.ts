import path from "node:path";
import dotenv from "dotenv";
import { describe, expect, it, vi } from "vitest";

vi.mock("dotenv", () => ({
  default: {
    config: vi.fn(),
  },
}));

vi.mock("./program.js", () => ({
  program: {
    parse: vi.fn(),
  },
}));

describe("cli entrypoint", () => {
  it("loads .env from process.cwd() and parses program arguments", async () => {
    await import("./cli.js");

    expect(dotenv.config).toHaveBeenCalledWith({
      path: path.join(process.cwd(), ".env"),
      quiet: true,
    });
    const { program } = await import("./program.js");
    expect(program.parse).toHaveBeenCalled();
  });
});
