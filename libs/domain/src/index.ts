/**
 * `@merge-mentor/domain` — dependency-free domain contracts and ports shared
 * by the platform adapters, AI providers, and review engines.
 */

export { AGENT_ROLE_IDS, type AgentRoleId } from "./agents.js";
export { type TokenUsage } from "./ai.js";
export { type DiffFileEntry, type DiffManifest } from "./diff.js";
export { type GitAuth, type GitClient, type GitCloneOptions, type GitFileChange } from "./git.js";
export {
  type CommentAction,
  type CrossFileFinding,
  type CrossFileReviewResult,
  type ExistingComment,
  type FileFinding,
  type FileReviewResult,
  type FileStatus,
  type FindingCategory,
  type FindingSeverity,
  type PBIComment,
  type PBIDetails,
  type PRDetails,
  type PRFile,
  type Platform,
  type PlatformAdapter,
  type ProjectDependency,
  type ProjectDetails,
  type ProjectWorkItem,
  type RepoInfo,
  type UnresolvedComment,
  type UnresolvedCommentThread,
  type WorkItemState,
} from "./platform.js";
