import { Badge, Group } from "@mantine/core";

/** Ordered severity levels used across result views. */
export const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

/** Color mapping shared by severity badges and finding cards. */
export const SEVERITY_COLORS: Record<string, string> = {
  critical: "red",
  high: "orange",
  medium: "yellow",
  low: "blue",
};

interface SeveritySummaryProps {
  readonly findings: readonly { readonly severity: string }[];
}

/** Compact severity count bar shown at the top of a result card. */
export function SeveritySummary({ findings }: SeveritySummaryProps) {
  if (findings.length === 0) return null;

  return (
    <Group gap="xs">
      <Badge variant="filled" color="gray">
        {findings.length} finding{findings.length === 1 ? "" : "s"}
      </Badge>
      {SEVERITY_ORDER.map((severity) => {
        const count = findings.filter((finding) => finding.severity === severity).length;
        if (count === 0) return null;
        return (
          <Badge key={severity} variant="light" color={SEVERITY_COLORS[severity] ?? "gray"}>
            {count} {severity}
          </Badge>
        );
      })}
    </Group>
  );
}
