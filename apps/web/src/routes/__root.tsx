import {
  AppShell,
  Badge,
  Burger,
  ColorSchemeScript,
  Container,
  Group,
  Image,
  MantineProvider,
  NavLink,
  Stack,
  Title,
  mantineHtmlProps,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { HeadContent, Link, Scripts, createRootRoute, useLocation } from "@tanstack/react-router";

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
      { rel: "icon", type: "image/png", href: "/logo_transparent.png" },
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
  const [navOpened, { toggle, close }] = useDisclosure(false);
  const { pathname } = useLocation();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !navOpened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="xs">
          <Burger
            opened={navOpened}
            onClick={toggle}
            hiddenFrom="sm"
            size="sm"
            aria-label="Toggle navigation"
          />
          <Image
            src="/logo_transparent.png"
            alt="Merge Mentor logo"
            h={40}
            w="auto"
            fit="contain"
          />
          <Title order={4}>Merge Mentor</Title>
          <Badge variant="light" visibleFrom="sm">
            Web UI
          </Badge>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="md">
        <Stack gap={4}>
          <NavLink
            component={Link}
            to="/"
            label="Home"
            variant="light"
            active={pathname === "/"}
            onClick={close}
          />
          <NavLink
            component={Link}
            to="/review"
            label="PR Review"
            variant="light"
            active={pathname === "/review"}
            onClick={close}
          />
          <NavLink
            component={Link}
            to="/pbi"
            label="PBI Review"
            variant="light"
            active={pathname === "/pbi"}
            onClick={close}
          />
          <NavLink
            component={Link}
            to="/project"
            label="Project Review"
            variant="light"
            active={pathname === "/project"}
            onClick={close}
          />
          <NavLink
            component={Link}
            to="/reports"
            label="Reports"
            variant="light"
            active={pathname === "/reports"}
            onClick={close}
          />
          <NavLink
            component={Link}
            to="/audit"
            label="Audit Log"
            variant="light"
            active={pathname === "/audit"}
            onClick={close}
          />
          <NavLink
            component={Link}
            to="/config"
            label="Configuration"
            variant="light"
            active={pathname === "/config"}
            onClick={close}
          />
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>
        <Container size="lg">{children}</Container>
      </AppShell.Main>
    </AppShell>
  );
}
