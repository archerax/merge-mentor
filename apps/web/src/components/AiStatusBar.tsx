import { ActionIcon, Badge, Group, Text, Tooltip } from "@mantine/core";
import { IconKey, IconRefresh, IconUserCheck, IconAlertTriangle } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { getAiStatus } from "../server/aiStatus.functions.js";
import type { AiStatus } from "../server/aiStatus.types.js";

/** Presentation of an {@link AiStatus}: what is shown and how loudly. */
export interface AiStatusDisplay {
  readonly label: string;
  readonly detail: string;
  readonly color: "green" | "orange" | "red" | "gray";
  readonly icon: "user" | "byok" | "warning";
}

const AUTH_TYPE_LABELS: Record<string, string> = {
  user: "Copilot login",
  "gh-cli": "GitHub CLI login",
  env: "environment token",
  token: "MM_COPILOT_TOKEN",
  hmac: "HMAC",
  "api-key": "API key",
};

/** Maps a raw status to the text and colour shown in the status bar. */
export function describeAiStatus(status: AiStatus): AiStatusDisplay {
  switch (status.kind) {
    case "copilot": {
      const source = status.usesConfiguredToken
        ? "MM_COPILOT_TOKEN"
        : status.authType
          ? (AUTH_TYPE_LABELS[status.authType] ?? status.authType)
          : "local credentials";
      const host = status.host ? ` on ${status.host}` : "";
      const plan = status.copilotPlan ? ` Plan: ${status.copilotPlan}.` : "";
      const orgs = status.organizations?.length
        ? ` Organizations: ${status.organizations.join(", ")}.`
        : "";
      return {
        label: status.login
          ? `Copilot: ${status.login}${status.copilotPlan ? ` (${status.copilotPlan})` : ""}`
          : "Copilot: signed in (user unknown)",
        detail: `Requests run as ${status.login ?? "an unidentified Copilot user"}${host} via ${source}.${plan}${orgs}`,
        color: "green",
        icon: "user",
      };
    }
    case "byok":
      return {
        label: "BYOK",
        detail: `Bring-your-own-key: requests go to ${status.endpoint}, not GitHub Copilot${
          status.hasApiKey ? " (API key set)" : " (no API key)"
        }.`,
        color: "orange",
        icon: "byok",
      };
    case "copilot-unauthenticated":
      return {
        label: "Copilot: not signed in",
        detail: status.message,
        color: "red",
        icon: "warning",
      };
    case "copilot-error":
      return {
        label: "Copilot: status unavailable",
        detail: status.message,
        color: "red",
        icon: "warning",
      };
    case "other-provider":
      return {
        label: `AI provider: ${status.provider}`,
        detail: `Requests use the ${status.provider} provider; Copilot is not used.`,
        color: "gray",
        icon: "user",
      };
  }
}

const ICONS = { user: IconUserCheck, byok: IconKey, warning: IconAlertTriangle } as const;

/** Presentational status pill; separated from data loading for testing. */
export function AiStatusIndicator({ status }: { readonly status: AiStatus | undefined }) {
  if (!status) {
    return (
      <Text size="xs" c="dimmed">
        Checking AI account…
      </Text>
    );
  }
  const display = describeAiStatus(status);
  const Icon = ICONS[display.icon];
  return (
    <Tooltip label={display.detail} withArrow multiline maw={360}>
      <Badge
        variant="light"
        color={display.color}
        leftSection={<Icon size={12} />}
        style={{ textTransform: "none" }}
        role="status"
      >
        {display.label}
      </Badge>
    </Tooltip>
  );
}

/** Footer bar showing which AI account (or BYOK endpoint) requests will use. */
export function AiStatusBar() {
  const [status, setStatus] = useState<AiStatus | undefined>();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (force: boolean) => {
    setLoading(true);
    try {
      setStatus(await getAiStatus({ data: { force } }));
    } catch (error) {
      setStatus({ kind: "copilot-error", message: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <Group h="100%" px="md" gap="xs" wrap="nowrap">
      <Text size="xs" c="dimmed">
        AI requests run as:
      </Text>
      <AiStatusIndicator status={status} />
      <Tooltip label="Re-check AI account" withArrow>
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label="Refresh AI account status"
          loading={loading}
          onClick={() => void load(true)}
        >
          <IconRefresh size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
