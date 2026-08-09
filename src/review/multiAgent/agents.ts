import type { ReviewPass } from "../reviewSelection.js";

/**
 * The five hardcoded specialized subagent roles used by the multi-agent
 * strategy. Custom domain agents are post-MVP.
 */
const AGENT_ROLE_IDS = ["general", "security", "performance", "testing", "architecture"] as const;

/** Union of the five hardcoded specialized subagent role identifiers. */
export type AgentRoleId = (typeof AGENT_ROLE_IDS)[number];

/**
 * A specialized subagent role in the multi-agent strategy.
 *
 * Defines a stable identifier, a human-readable label, an emoji used in
 * progress output, and the ReviewPass values that dispatch to this agent.
 */
export interface AgentRole {
  /** Stable identifier for the agent role (e.g. "security"). */
  readonly id: AgentRoleId;
  /** Human-readable agent name shown in logs and streaming output. */
  readonly label: string;
  /** Emoji glyph used to decorate progress messages for this agent. */
  readonly emoji: string;
  /** ReviewPass values that dispatch to this agent. */
  readonly passes: readonly ReviewPass[];
}

/**
 * Pass-to-agent mapping from the multi-agent reviewer spec. Each configured
 * ReviewPass resolves to exactly one subagent; multiple passes can target the
 * same agent and that agent's prompt covers each configured lens.
 */
export const AGENT_ROLES: readonly AgentRole[] = [
  {
    id: "general",
    label: "General Logic & Correctness Agent",
    emoji: "🧠",
    passes: ["logic", "scan"],
  },
  {
    id: "security",
    label: "Security & Trust Agent",
    emoji: "🔒",
    passes: ["security"],
  },
  {
    id: "performance",
    label: "Performance & Scalability Agent",
    emoji: "⚡",
    passes: ["performance", "database"],
  },
  {
    id: "testing",
    label: "Test Coverage & Quality Agent",
    emoji: "🧪",
    passes: ["testing"],
  },
  {
    id: "architecture",
    label: "Architecture & Style Agent",
    emoji: "🏗️",
    passes: ["monorepo"],
  },
];

const PASS_TO_AGENT = new Map<ReviewPass, AgentRoleId>();
for (const agent of AGENT_ROLES) {
  for (const pass of agent.passes) {
    PASS_TO_AGENT.set(pass, agent.id);
  }
}

/**
 * Type guard that checks whether a string is a known agent role identifier.
 *
 * @param value - Arbitrary string to test.
 * @returns `true` when the value matches one of the defined agent role ids.
 */
export function isAgentRoleId(value: string): value is AgentRoleId {
  return (AGENT_ROLE_IDS as readonly string[]).includes(value);
}

/** Resolves a single ReviewPass to its target subagent role. */
export function resolveAgentForPass(pass: ReviewPass): AgentRoleId | undefined {
  return PASS_TO_AGENT.get(pass);
}

/**
 * Resolves a set of ReviewPasses into the unique set of subagents to dispatch,
 * preserving the canonical AGENT_ROLES ordering.
 */
export function resolveAgentsFromPasses(passes: readonly ReviewPass[]): AgentRoleId[] {
  const selected = new Set<AgentRoleId>();
  for (const pass of passes) {
    const agent = resolveAgentForPass(pass);
    if (agent) {
      selected.add(agent);
    }
  }

  return AGENT_ROLES.map((role) => role.id).filter((id) => selected.has(id));
}

/** Returns the canonical set of all agent ids (used when no passes are configured). */
export function getAllAgentIds(): AgentRoleId[] {
  return [...AGENT_ROLE_IDS];
}

/**
 * Returns the role definition for a given agent id, or `undefined` if the id
 * is not a known agent role.
 *
 * @param id - Agent role identifier to look up.
 * @returns The matching {@link AgentRole}, or `undefined` when not found.
 */
export function getAgentRole(id: AgentRoleId): AgentRole | undefined {
  return AGENT_ROLES.find((role) => role.id === id);
}
