import { ValidationError } from "../errors/index.js";
import type { BuildPlatform, BuildReference } from "./types.js";

export function createBuildReference(options: {
  platform?: string;
  runId?: string | number;
  buildId?: string | number;
  owner?: string;
  repo?: string;
  org?: string;
  project?: string;
}): BuildReference {
  if (options.runId !== undefined && options.buildId !== undefined) {
    throw new ValidationError("build identifier", "--run-id and --build-id cannot be combined");
  }
  const platform = options.platform as BuildPlatform | undefined;
  if (platform !== "github" && platform !== "azure") {
    throw new ValidationError("platform", "must be github or azure");
  }
  const id = platform === "github" ? options.runId : options.buildId;
  if (id === undefined || !/^\d+$/.test(String(id)) || Number(id) < 1) {
    throw new ValidationError(
      platform === "github" ? "run-id" : "build-id",
      `a positive numeric ${platform === "github" ? "workflow run" : "build"} ID is required`
    );
  }
  const ownerOrOrg = platform === "github" ? options.owner : options.org;
  const repository = options.repo;
  if (!ownerOrOrg || !repository || (platform === "azure" && !options.project)) {
    throw new ValidationError("repository", "platform repository context is incomplete");
  }
  return {
    platform,
    id: String(id),
    ownerOrOrg,
    repository,
    ...(platform === "azure" ? { project: options.project } : {}),
  };
}
