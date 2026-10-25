import { Alert, Code, Stack } from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";

import { ConfigViewer } from "../components/ConfigViewer.js";
import { PageHeader } from "../components/PageHeader.js";
import { getConfig } from "../server/config.functions.js";

export const Route = createFileRoute("/config")({
  loader: () => getConfig(),
  component: ConfigPage,
});

function ConfigPage() {
  const view = Route.useLoaderData();

  return (
    <Stack gap="lg">
      <PageHeader
        title="Configuration"
        description={
          <>
            Settings that control how Merge Mentor connects to your repository and AI provider and
            how it runs reviews. Empty settings use their built-in default. Changes are saved to the
            project <Code>.env</Code> file; tokens and keys are never displayed, so leave them empty
            to keep the current value, or type a new one to replace it.
          </>
        }
      />

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
