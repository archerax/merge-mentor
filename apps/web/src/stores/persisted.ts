import { create, type StateCreator } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

/** Prefix shared by every persisted store's storage key. */
const STORAGE_PREFIX = "merge-mentor:";

/** Which browser storage a store persists to. */
type StorageArea = "session" | "local";

interface PersistedStoreOptions<TState, TPersisted> {
  /** Storage key, without the shared prefix. Must be unique. */
  readonly name: string;
  /** Bump when the persisted shape changes; other versions fall back to defaults. */
  readonly version: number;
  /** `session` (default) keeps state for the tab; `local` keeps it across visits. */
  readonly area?: StorageArea;
  /** Picks the fields to save. Never include files, tokens or anything that acts on the user's behalf. */
  readonly partialize: (state: TState) => TPersisted;
  /**
   * Turns whatever was in storage into well-formed fields, dropping the rest,
   * so edited or stale data can never break the page.
   */
  readonly sanitize: (persisted: unknown) => Partial<TPersisted>;
}

/** Hydrators of stores created before the app finished hydrating. */
const pendingHydrations: (() => void)[] = [];
let appHydrated = false;

function browserStorage(area: StorageArea): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return area === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    // Access can throw when site data is blocked.
    return null;
  }
}

/** Narrows stored JSON to a plain object, or `null` for anything else. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Creates a Zustand store whose `partialize`d fields are saved to browser
 * storage under `merge-mentor:<name>`.
 *
 * SSR-safe by design: storage is only touched in the browser, and stores start
 * from their defaults so the first client render matches the server HTML.
 * Saved values are applied by {@link hydratePersistedStores} once the app has
 * hydrated (or immediately, for stores whose route chunk loads later). Writes
 * are ignored until then, so an effect that runs before hydration cannot
 * overwrite what was saved.
 */
export function createPersistedStore<TState extends object, TPersisted>(
  initializer: StateCreator<TState, [["zustand/persist", unknown]]>,
  options: PersistedStoreOptions<TState, TPersisted>
) {
  const area = options.area ?? "session";
  let hydrated = false;

  const storage: StateStorage = {
    getItem: (name) => {
      try {
        return browserStorage(area)?.getItem(name) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      if (!hydrated) return;
      try {
        browserStorage(area)?.setItem(name, value);
      } catch {
        // Quota or blocked storage: the value simply isn't saved.
      }
    },
    removeItem: (name) => {
      try {
        browserStorage(area)?.removeItem(name);
      } catch {
        // Nothing to remove.
      }
    },
  };

  const store = create<TState>()(
    persist<TState, [], [], Partial<TPersisted>>(initializer, {
      name: `${STORAGE_PREFIX}${options.name}`,
      version: options.version,
      storage: createJSONStorage<Partial<TPersisted>>(() => storage),
      partialize: options.partialize,
      skipHydration: true,
      // Data from another version is not trusted: start from the defaults.
      // Writes are opened first so the persist middleware replaces the stale
      // payload instead of leaving it to be discarded again on every load.
      migrate: () => {
        hydrated = true;
        return {};
      },
      merge: (persisted, current) => ({ ...current, ...options.sanitize(persisted) }),
      // Runs after success and after failure (such as unparseable JSON), which leaves the defaults.
      onRehydrateStorage: () => () => {
        hydrated = true;
      },
    })
  );

  const hydrate = () => {
    void store.persist.rehydrate();
  };
  if (appHydrated) {
    hydrate();
  } else {
    pendingHydrations.push(hydrate);
  }

  return store;
}

/**
 * Applies saved values to every persisted store. Call once from a client
 * effect after hydration; stores created later hydrate as they are created.
 */
export function hydratePersistedStores(): void {
  appHydrated = true;
  for (const hydrate of pendingHydrations.splice(0)) hydrate();
}
