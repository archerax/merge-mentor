import {
  Alert,
  Badge,
  Button,
  Code,
  Grid,
  Group,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { saveConfig } from "../server/config.functions.js";
import type { ConfigFieldError, ConfigFieldView, ConfigView } from "../server/config.types.js";
import { isFieldVisible } from "./configVisibility.js";

interface ConfigViewerProps {
  readonly view: ConfigView;
}

type SaveStatus = "idle" | "saving" | "saved";

const ADVANCED_STORAGE_KEY = "merge-mentor:config:show-advanced";

export function ConfigViewer({ view }: ConfigViewerProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<readonly string[]>([]);
  const [errors, setErrors] = useState<readonly ConfigFieldError[]>([]);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [activeTab, setActiveTab] = useState<string | null>(view.sections[0]?.title ?? null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    try {
      setShowAdvanced(window.localStorage.getItem(ADVANCED_STORAGE_KEY) === "true");
    } catch {
      // Storage can be unavailable (private mode, blocked site data); default to hidden.
    }
  }, []);

  function toggleAdvanced(next: boolean) {
    setShowAdvanced(next);
    try {
      window.localStorage.setItem(ADVANCED_STORAGE_KEY, String(next));
    } catch {
      // The preference simply won't persist.
    }
  }

  // A cleared platform means "use the default", so no platform is assumed and both groups show.
  const draftPlatform = draft.MM_PLATFORM;
  const selectedPlatform =
    draftPlatform === ""
      ? undefined
      : (draftPlatform ??
        view.sections.flatMap((section) => section.fields).find((f) => f.envVar === "MM_PLATFORM")
          ?.value ??
        undefined);

  function isVisible(field: ConfigFieldView): boolean {
    return isFieldVisible(field, {
      showAdvanced,
      selectedPlatform,
      touched:
        draft[field.envVar] !== undefined ||
        cleared.includes(field.envVar) ||
        errors.some((item) => item.envVar === field.envVar),
    });
  }

  const sections = view.sections
    .map((section) => ({ ...section, fields: section.fields.filter(isVisible) }))
    .filter((section) => section.fields.length > 0);
  const hiddenCount = view.sections
    .flatMap((section) => section.fields)
    .filter((field) => !isVisible(field)).length;
  const currentTab = sections.some((section) => section.title === activeTab)
    ? activeTab
    : (sections[0]?.title ?? null);

  // Keep state in step with the displayed tab when the active one is filtered out.
  useEffect(() => {
    if (currentTab !== activeTab) setActiveTab(currentTab);
  }, [currentTab, activeTab]);

  const labels = new Map(
    view.sections.flatMap((section) => section.fields.map((field) => [field.envVar, field.label]))
  );
  const changeCount = Object.keys(draft).length + cleared.length;
  const dirty = changeCount > 0;

  function updateField(envVar: string, value: string, original: string) {
    setDraft((previous) => {
      const next = { ...previous };
      if (value === original) {
        delete next[envVar];
      } else {
        next[envVar] = value;
      }
      return next;
    });
    setCleared((previous) => previous.filter((item) => item !== envVar));
    setErrors([]);
    setStatus("idle");
  }

  function toggleClear(envVar: string) {
    setDraft((previous) => {
      const next = { ...previous };
      delete next[envVar];
      return next;
    });
    setCleared((previous) =>
      previous.includes(envVar) ? previous.filter((item) => item !== envVar) : [...previous, envVar]
    );
    setErrors([]);
    setStatus("idle");
  }

  async function save() {
    setStatus("saving");
    setErrors([]);

    const edits = [
      ...Object.entries(draft).map(([envVar, value]) => ({ envVar, value })),
      ...cleared.map((envVar) => ({ envVar, value: "" })),
    ];

    const result = await saveConfig({ data: { edits } });
    if (!result.ok) {
      setErrors(result.errors);
      setStatus("idle");
      return;
    }

    setDraft({});
    setCleared([]);
    setStatus("saved");
    await router.invalidate();
  }

  function reset() {
    setDraft({});
    setCleared([]);
    setErrors([]);
    setStatus("idle");
  }

  return (
    <Stack gap="xl">
      {view.warnings.length > 0 && (
        <Alert title="Configuration warnings" color="yellow">
          <Stack gap={4}>
            {view.warnings.map((warning) => (
              <Text key={warning} size="sm">
                {warning}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}

      {errors.length > 0 && (
        <Alert title="Some values are invalid" color="red">
          <Stack gap={4}>
            {errors.map((error) => (
              <Text key={error.envVar} size="sm">
                <b>{labels.get(error.envVar) ?? error.envVar}</b>: {error.message}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}

      {status === "saved" && (
        <Alert title="Configuration saved" color="green">
          Your changes were written to the project <Code>.env</Code> file.
        </Alert>
      )}

      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {hiddenCount > 0
            ? `${hiddenCount} ${hiddenCount === 1 ? "setting is" : "settings are"} hidden.`
            : "\u00A0"}
        </Text>
        <Switch
          label="Show advanced settings"
          checked={showAdvanced}
          onChange={(event) => toggleAdvanced(event.currentTarget.checked)}
        />
      </Group>

      <Tabs value={currentTab} onChange={setActiveTab} keepMounted={false}>
        <Tabs.List>
          {sections.map((section) => {
            const hasError = section.fields.some((field) =>
              errors.some((item) => item.envVar === field.envVar)
            );
            const modified = section.fields.some(
              (field) => draft[field.envVar] !== undefined || cleared.includes(field.envVar)
            );
            return (
              <Tabs.Tab
                key={section.title}
                value={section.title}
                aria-label={
                  hasError
                    ? `${section.title} — has invalid values`
                    : modified
                      ? `${section.title} — has unsaved changes`
                      : undefined
                }
                rightSection={
                  hasError || modified ? (
                    <Badge size="xs" circle color={hasError ? "red" : "yellow"} aria-hidden />
                  ) : null
                }
              >
                {section.title}
              </Tabs.Tab>
            );
          })}
        </Tabs.List>

        {sections.map((section) => (
          <Tabs.Panel key={section.title} value={section.title} pt="md">
            <Stack gap="md">
              <Text c="dimmed" size="sm">
                {section.description}
              </Text>
              <Grid gap="md" align="flex-start">
                {section.fields.map((field) => (
                  <ConfigRow
                    key={field.envVar}
                    field={field}
                    draftValue={draft[field.envVar]}
                    cleared={cleared.includes(field.envVar)}
                    error={errors.find((item) => item.envVar === field.envVar)?.message}
                    onChange={(value) => updateField(field.envVar, value, originalValue(field))}
                    onToggleClear={() => toggleClear(field.envVar)}
                  />
                ))}
              </Grid>
            </Stack>
          </Tabs.Panel>
        ))}
      </Tabs>

      <Paper
        withBorder
        p="sm"
        radius="md"
        style={{ position: "sticky", bottom: 0, zIndex: 10 }}
        role="region"
        aria-label="Save configuration"
      >
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {dirty
              ? `${changeCount} unsaved ${changeCount === 1 ? "change" : "changes"}`
              : "No unsaved changes"}
          </Text>
          <Group>
            <Button variant="default" onClick={reset} disabled={!dirty || status === "saving"}>
              Discard changes
            </Button>
            <Button onClick={save} loading={status === "saving"} disabled={!dirty}>
              Save changes
            </Button>
          </Group>
        </Group>
      </Paper>
    </Stack>
  );
}

/** Returns the value an untouched field currently resolves to. */
function originalValue(field: ConfigFieldView): string {
  return field.secret ? "" : (field.value ?? "");
}

interface ConfigRowProps {
  readonly field: ConfigFieldView;
  readonly draftValue: string | undefined;
  readonly cleared: boolean;
  readonly error: string | undefined;
  readonly onChange: (value: string) => void;
  readonly onToggleClear: () => void;
}

function ConfigRow({ field, draftValue, cleared, error, onChange, onToggleClear }: ConfigRowProps) {
  const value = draftValue ?? originalValue(field);

  return (
    <>
      <Grid.Col span={{ base: 12, sm: 5 }}>
        <Stack gap={2}>
          <Group gap="xs">
            <Text size="sm" fw={500}>
              {field.label}
            </Text>
            {(draftValue !== undefined || cleared) && (
              <Badge size="xs" variant="light" color="yellow">
                Modified
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {field.description}
          </Text>
          {field.note && (
            <Text size="xs" c="dimmed">
              {field.note}
            </Text>
          )}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, sm: 7 }}>
        <Stack gap={4}>
          <Group gap="xs" align="center">
            <ConfigInput field={field} value={value} cleared={cleared} onChange={onChange} />
            {field.secret && field.set && (
              <Button
                size="compact-xs"
                variant="subtle"
                color={cleared ? "gray" : "red"}
                onClick={onToggleClear}
              >
                {cleared ? "Undo" : "Clear"}
              </Button>
            )}
          </Group>
          {error && (
            <Text size="xs" c="red">
              {error}
            </Text>
          )}
        </Stack>
      </Grid.Col>
    </>
  );
}

interface ConfigInputProps {
  readonly field: ConfigFieldView;
  readonly value: string;
  readonly cleared: boolean;
  readonly onChange: (value: string) => void;
}

function ConfigInput({ field, value, cleared, onChange }: ConfigInputProps) {
  switch (field.type) {
    case "boolean":
      return (
        <Group gap="xs" wrap="nowrap">
          <Switch
            aria-label={field.label}
            checked={value === "true"}
            onChange={(event) => onChange(event.currentTarget.checked ? "true" : "false")}
            label={value === "true" ? "Enabled" : "Disabled"}
          />
        </Group>
      );
    case "enum":
      return (
        <Select
          style={{ flex: 1, minWidth: 0 }}
          aria-label={field.label}
          data={field.options ?? []}
          value={value === "" ? null : value}
          onChange={(next) => onChange(next ?? "")}
          placeholder="Use default"
          clearable
        />
      );
    case "number":
      return (
        <TextInput
          style={{ flex: 1, minWidth: 0 }}
          aria-label={field.label}
          type="number"
          min={1}
          value={value}
          placeholder="Not set"
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      );
    case "secret":
      return (
        <PasswordInput
          aria-label={field.label}
          style={{ flex: 1, minWidth: 0 }}
          value={value}
          placeholder={
            cleared ? "Will be cleared" : field.set ? "Set (hidden) — type to replace" : "Not set"
          }
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      );
    case "text":
      return (
        <TextInput
          aria-label={field.label}
          style={{ flex: 1, minWidth: 0 }}
          value={value}
          placeholder="Not set"
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      );
    default:
      return null;
  }
}
