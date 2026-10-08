import { Alert, Code, Stack, Text, Title } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

import { ConfigViewer } from "../components/ConfigViewer.js";
import { getConfig } from "../server/config.functions.js";

export const Route = createFileRoute("/config")({
  loader: () => getConfig(),
  component: ConfigPage,
});

function ConfigPage() {
  const view = Route.useLoaderData();

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Configuration</Title>
        <Text c="dimmed">
          View and edit the configuration resolved from the web server&apos;s environment, an
          optional <Code>.env</Code> file, and built-in defaults. Saving writes changes to the
          project <Code>.env</Code> file; sensitive values are never displayed.
        </Text>
      </div>

      {view.error ? (
        <Alert title="Configuration could not be loaded" color="red">
          {view.error}
        </Alert>
      ) : (
        <ConfigViewer view={view} />
      )}
    </Stack>
  );
}
