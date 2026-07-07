import path from "node:path";
import { z } from "zod";
import { createChildLogger } from "../logger.js";
import type { FileSystem } from "../ports/index.js";
import type { TestMapperOptions } from "../utils/testFileMapper.js";

const ProjectConfigSchema = z
  .object({
    testFilePatterns: z.array(z.string()).optional(),
    testMapping: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export class ConfigLoader {
  private readonly fileSystem: FileSystem;
  private readonly logger = createChildLogger({ component: "ConfigLoader" });

  constructor(fileSystem: FileSystem) {
    this.fileSystem = fileSystem;
  }

  /**
   * Loads custom project configuration (.mergementor.json) from the workspace root if it exists.
   */
  async loadProjectConfig(repoPath: string): Promise<TestMapperOptions> {
    const configPath = path.join(repoPath, ".mergementor.json");
    try {
      await this.fileSystem.access(configPath);
      const content = await this.fileSystem.readFile(configPath, "utf-8");
      if (!content || content.trim() === "") {
        return {};
      }
      const parsed = JSON.parse(content);
      const result = ProjectConfigSchema.safeParse(parsed);
      if (result.success) {
        this.logger.info(
          { projectConfig: result.data },
          "Loaded custom project configuration from .mergementor.json"
        );
        return {
          testFilePatterns: result.data.testFilePatterns,
          testMapping: result.data.testMapping,
        };
      }
      this.logger.warn(
        { error: result.error.format() },
        "Invalid .mergementor.json schema configuration"
      );
    } catch (error) {
      // Configuration is optional, do not throw on failure unless it is malformed JSON
      if (error instanceof SyntaxError) {
        this.logger.error({ error }, "Malformed JSON in .mergementor.json");
        throw new Error(`Failed to parse .mergementor.json: ${error.message}`);
      }
      this.logger.debug({ error }, "No custom project configuration found or readable");
    }
    return {};
  }
}
