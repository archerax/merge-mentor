import { Group, Paper, SimpleGrid, Skeleton, Stack } from "@mantine/core";

interface PageSkeletonProps {
  /** Number of stat tiles to sketch above the body (the stats and outcomes pages). */
  readonly tiles?: number;
  /** Number of body rows (table rows, list items or fields). */
  readonly rows?: number;
}

/**
 * Placeholder for a page whose data is still loading. Shaped like a
 * `PageHeader` followed by an optional row of stat tiles and a list, so the
 * layout does not jump when the page arrives. Used as a route
 * `pendingComponent`.
 */
export function PageSkeleton({ tiles = 0, rows = 6 }: PageSkeletonProps) {
  return (
    <Stack gap="lg" aria-busy="true" aria-label="Loading page" data-testid="page-skeleton">
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
        <Stack gap="xs" flex={1}>
          <Skeleton h={4} w={44} radius="xl" mb={4} />
          <Skeleton h={28} w={220} />
          <Skeleton h={14} maw={720} />
          <Skeleton h={14} maw={480} />
        </Stack>
        <Skeleton h={36} w={160} />
      </Group>

      {tiles > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} data-testid="page-skeleton-tiles">
          {Array.from({ length: tiles }, (_, index) => (
            <Paper key={index} withBorder radius="md" p="md">
              <Skeleton h={12} w="50%" mb="sm" />
              <Skeleton h={32} w="40%" />
            </Paper>
          ))}
        </SimpleGrid>
      )}

      <Stack gap="sm">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} h={36} data-testid="page-skeleton-row" />
        ))}
      </Stack>
    </Stack>
  );
}
