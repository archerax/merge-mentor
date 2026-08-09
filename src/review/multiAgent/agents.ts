import type { ReviewPass } from "../reviewSelection.js";

/**
 * The five hardcoded specialized subagent roles used by the multi-agent
 * strategy. Custom domain agents are post-MVP.
 */
const AGENT_ROLE_IDS = ["general", "security", "performance", "testing", "architecture"] as const;

export type AgentRoleId = (typeof AGENT_ROLE_IDS)[number];

export interface AgentRole {
  readonly id: AgentRoleId;
  readonly label: string;
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

export function getAgentRole(id: AgentRoleId): AgentRole | undefined {
  return AGENT_ROLES.find((role) => role.id === id);
}
