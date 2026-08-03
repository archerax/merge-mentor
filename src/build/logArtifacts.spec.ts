import { describe, expect, it, vi } from "vitest";
import { createStubFileSystem } from "../ports/fileSystem.test-helper.js";
import { storeLogArtifacts } from "./logArtifacts.js";

describe("storeLogArtifacts", () => {
  it("writes redacted failed-task logs and bounded tails", async () => {
    const fileSystem = createStubFileSystem();
    vi.spyOn(Date, "now").mockReturnValue(123);

    const result = await storeLogArtifacts(
      { platform: "github", id: "42", ownerOrOrg: "acme", repository: "app" },
      [
        {
          jobName: "typecheck / linux",
          content: "line 1\nTOKEN=secret\nerror TS2339",
          isFailureCandidate: true,
        },
      ],
      [{ id: "E1" } as never],
      { tempPath: "/tmp/mm", tailLines: 2, tailBytes: 100, fileSystem }
    );

    expect(result.directory).toBe("/tmp/mm/build-logs/github-42-123");
    expect(result.artifacts[0]).toMatchObject({
      filename: "001-typecheck_linux.log",
      tail: "TOKEN=[REDACTED]\nerror TS2339",
    });
    expect(fileSystem.writeFile).toHaveBeenCalledWith(
      "/tmp/mm/build-logs/github-42-123/001-typecheck_linux.log",
      "line 1\nTOKEN=[REDACTED]\nerror TS2339",
      "utf8"
    );
    expect(fileSystem.writeFile).toHaveBeenCalledWith(
      "/tmp/mm/build-logs/github-42-123/manifest.json",
      expect.stringContaining("001-typecheck_linux.log"),
      "utf8"
    );
  });
});
