import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect } from "react";

/** Message shown for an error, falling back to a generic one when it has none. */
export function describeRouteError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "An unexpected error occurred.";
}

/**
 * Shared route `errorComponent`: shows what went wrong and a **Try again**
 * button. Retrying resets the query error boundary (so `useSuspenseQuery`
 * fetches again instead of rethrowing the cached error), resets the route's
 * error boundary and re-runs the route loaders.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const queryErrorResetBoundary = useQueryErrorResetBoundary();

  // Clear the query error boundary as soon as the error is shown, as the
  // TanStack Router + Query guidance recommends, so a retry starts fresh.
  useEffect(() => {
    queryErrorResetBoundary.reset();
  }, [queryErrorResetBoundary]);

  function retry() {
    queryErrorResetBoundary.reset();
    reset();
    void router.invalidate();
  }

  return (
    <Stack gap="lg" py="md">
      <Alert
        color="red"
        title="Something went wrong loading this page"
        icon={<IconAlertTriangle size={18} />}
        role="alert"
      >
        <Stack gap="sm">
          <Text size="sm">{describeRouteError(error)}</Text>
          <Group>
            <Button
              variant="light"
              color="red"
              size="xs"
              leftSection={<IconRefresh size={14} />}
              onClick={retry}
            >
              Try again
            </Button>
          </Group>
        </Stack>
      </Alert>
    </Stack>
  );
}
