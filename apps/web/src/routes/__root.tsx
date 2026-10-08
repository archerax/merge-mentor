import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Burger,
  Code,
  ColorSchemeScript,
  Container,
  Group,
  Image,
  MantineProvider,
  NavLink,
  Stack,
  Text,
  Title,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
  mantineHtmlProps,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconBrandGithub,
  IconFileText,
  IconGitPullRequest,
  IconHistory,
  IconHome,
  IconListDetails,
  IconMoon,
  IconSettings,
  IconSitemap,
  IconSun,
} from "@tabler/icons-react";
import { HeadContent, Link, Scripts, createRootRoute, useLocation } from "@tanstack/react-router";

import { theme } from "../theme.js";

import appCss from "../styles.css?url";
import mantineCoreStyles from "@mantine/core/styles.css?url";

type RouteTo = React.ComponentProps<typeof Link>["to"];

interface NavItem {
  readonly to: RouteTo;
  readonly label: string;
  readonly icon: React.ComponentType<{ size?: number | string; stroke?: number | string }>;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "Home", icon: IconHome },
  { to: "/review", label: "PR Review", icon: IconGitPullRequest },
  { to: "/pbi", label: "PBI Review", icon: IconListDetails },
  { to: "/project", label: "Project Review", icon: IconSitemap },
  { to: "/reports", label: "Reports", icon: IconFileText },
  { to: "/audit", label: "Audit Log", icon: IconHistory },
  { to: "/config", label: "Configuration", icon: IconSettings },
];

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Merge Mentor" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/logo_transparent.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
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
        <MantineProvider theme={theme} defaultColorScheme="auto">
          <AppFrame>{children}</AppFrame>
        </MantineProvider>
        <Scripts />
      </body>
    </html>
  );
}

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light", { getInitialValueInEffect: true });
  const dark = computed === "dark";

  return (
    <Tooltip label={dark ? "Switch to light mode" : "Switch to dark mode"} withArrow>
      <ActionIcon
        variant="default"
        size="lg"
        radius="md"
        aria-label="Toggle color scheme"
        onClick={() => setColorScheme(dark ? "light" : "dark")}
      >
        {dark ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}

function AppFrame({ children }: { children: React.ReactNode }) {
  const [navOpened, { toggle, close }] = useDisclosure(false);
  const { pathname } = useLocation();

  return (
    <AppShell
      header={{ height: 64 }}
      navbar={{ width: 260, breakpoint: "sm", collapsed: { mobile: !navOpened } }}
      footer={{ height: 48 }}
      padding="md"
    >
      <AppShell.Header
        style={{
          backdropFilter: "blur(12px)",
          backgroundColor: "color-mix(in srgb, var(--mantine-color-body) 82%, transparent)",
          borderColor: "var(--mantine-color-default-border)",
        }}
      >
        <Group h="100%" px="md" gap="sm" wrap="nowrap">
          <Burger
            opened={navOpened}
            onClick={toggle}
            hiddenFrom="sm"
            size="sm"
            aria-label="Toggle navigation"
          />
          <Group gap="sm" wrap="nowrap" flex={1}>
            <Image
              src="/logo_transparent.png"
              alt="Merge Mentor logo"
              h={38}
              w={38}
              fit="contain"
            />
            <Group gap="xs" wrap="nowrap">
              <Title order={4} fw={700}>
                Merge Mentor
              </Title>
              <Badge variant="light" visibleFrom="sm">
                Web UI
              </Badge>
            </Group>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <ColorSchemeToggle />
            <ActionIcon
              component="a"
              href="https://github.com/archerax/merge-mentor"
              target="_blank"
              rel="noreferrer"
              variant="default"
              size="lg"
              radius="md"
              aria-label="Open repository"
              visibleFrom="sm"
            >
              <IconBrandGithub size={18} />
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <Stack gap={4}>
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
            const active = pathname === to;
            return (
              <NavLink
                key={to}
                component={Link}
                to={to}
                label={label}
                active={active}
                onClick={close}
                leftSection={<Icon size={18} stroke={1.75} />}
              />
            );
          })}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box py="md">
          <Container size="lg">{children}</Container>
        </Box>
      </AppShell.Main>

      <AppShell.Footer p="xs">
        <Group justify="space-between" h="100%" px="md">
          <Text size="xs" c="dimmed">
            Merge Mentor · Local workspace
          </Text>
          <Text size="xs" c="dimmed" visibleFrom="sm">
            Reports and logs are read from <Code>.mergementor</Code>
          </Text>
        </Group>
      </AppShell.Footer>
    </AppShell>
  );
}
