import {
  Alert,
  Button,
  Code,
  Grid,
  Group,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { saveConfig } from "../server/config.functions.js";
import type { ConfigFieldError, ConfigFieldView, ConfigView } from "../server/config.types.js";

interface ConfigViewerProps {
  readonly view: ConfigView;
}

type SaveStatus = "idle" | "saving" | "saved";

export function ConfigViewer({ view }: ConfigViewerProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<readonly string[]>([]);
  const [errors, setErrors] = useState<readonly ConfigFieldError[]>([]);
  const [status, setStatus] = useState<SaveStatus>("idle");

  const dirty = Object.keys(draft).length > 0 || cleared.length > 0;

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
                <Code>{error.envVar}</Code>: {error.message}
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

      {view.sections.map((section) => (
        <Stack key={section.title} gap="xs">
          <div>
            <Title order={4}>{section.title}</Title>
            <Text c="dimmed" size="sm">
              {section.description}
            </Text>
          </div>
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
      ))}

      <Group justify="flex-end">
        <Button variant="default" onClick={reset} disabled={!dirty || status === "saving"}>
          Reset
        </Button>
        <Button onClick={save} loading={status === "saving"} disabled={!dirty}>
          Save changes
        </Button>
      </Group>
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
          <Text size="sm" fw={500}>
            {field.label}
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
            checked={value === "true"}
            onChange={(event) => onChange(event.currentTarget.checked ? "true" : "false")}
          />
          <Text size="sm" c="dimmed">
            {value === "true" ? "true" : "false"}
          </Text>
        </Group>
      );
    case "enum":
      return (
        <Select
          style={{ flex: 1, minWidth: 0 }}
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
