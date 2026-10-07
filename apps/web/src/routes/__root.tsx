import {
  Anchor,
  AppShell,
  Badge,
  ColorSchemeScript,
  Container,
  Group,
  MantineProvider,
  mantineHtmlProps,
  Title,
} from "@mantine/core";
import { HeadContent, Link, Scripts, createRootRoute } from "@tanstack/react-router";

import appCss from "../styles.css?url";
import mantineCoreStyles from "@mantine/core/styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Merge Mentor" },
    ],
    links: [
      { rel: "stylesheet", href: mantineCoreStyles },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript />
        <HeadContent />
      </head>
      <body>
        <MantineProvider defaultColorScheme="auto">
          <AppFrame>{children}</AppFrame>
        </MantineProvider>
        <Scripts />
      </body>
    </html>
  );
}

function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Container size="lg" h="100%">
          <Group h="100%" justify="space-between">
            <Group gap="xs">
              <Title order={4}>Merge Mentor</Title>
              <Badge variant="light">Web UI</Badge>
            </Group>
            <Group gap="md">
              <Anchor component={Link} to="/">
                Home
              </Anchor>
              <Anchor component={Link} to="/audit">
                Audit Log
              </Anchor>
            </Group>
          </Group>
        </Container>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="lg">{children}</Container>
      </AppShell.Main>
    </AppShell>
  );
}
