/**
 * The five hardcoded specialized subagent roles used by the multi-agent
 * strategy. Custom domain agents are post-MVP.
 */
export const AGENT_ROLE_IDS = [
  "general",
  "security",
  "performance",
  "testing",
  "architecture",
] as const;

/** Union of the five hardcoded specialized subagent role identifiers. */
export type AgentRoleId = (typeof AGENT_ROLE_IDS)[number];
