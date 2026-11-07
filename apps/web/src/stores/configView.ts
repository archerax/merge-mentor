import { asRecord, createPersistedStore } from "./persisted.js";

interface ConfigViewState {
  readonly activeTab: string | null;
  readonly showAdvanced: boolean;
  setActiveTab(activeTab: string | null): void;
  setShowAdvanced(showAdvanced: boolean): void;
}

type PersistedConfigView = Pick<ConfigViewState, "activeTab" | "showAdvanced">;

/** Keeps the well-formed configuration page fields from storage. */
function sanitizeConfigView(persisted: unknown): Partial<PersistedConfigView> {
  const record = asRecord(persisted);
  if (!record) return {};
  return {
    ...(typeof record.activeTab === "string" || record.activeTab === null
      ? { activeTab: record.activeTab }
      : {}),
    ...(typeof record.showAdvanced === "boolean" ? { showAdvanced: record.showAdvanced } : {}),
  };
}

/** Where "show advanced" was kept before this store existed. */
const LEGACY_SHOW_ADVANCED_KEY = "merge-mentor:config:show-advanced";

/** Reads a "show advanced" choice saved under the old key, without removing it. */
function readLegacyShowAdvanced(): Partial<PersistedConfigView> | null {
  try {
    const legacy = window.localStorage.getItem(LEGACY_SHOW_ADVANCED_KEY);
    return legacy === null ? null : { showAdvanced: legacy === "true" };
  } catch {
    return null;
  }
}

/** Removes the old key once the choice is saved in the store's own payload. */
function discardLegacyShowAdvanced(): void {
  try {
    window.localStorage.removeItem(LEGACY_SHOW_ADVANCED_KEY);
  } catch {
    // Nothing to remove.
  }
}

/**
 * The configuration page's active tab and "show advanced" switch. Kept in
 * local storage, as "show advanced" was before, so the preference outlives the
 * tab. The unsaved draft is deliberately not persisted.
 */
export const useConfigViewStore = createPersistedStore<ConfigViewState, PersistedConfigView>(
  (set) => ({
    activeTab: null,
    showAdvanced: false,
    setActiveTab: (activeTab) => set({ activeTab }),
    setShowAdvanced: (showAdvanced) => set({ showAdvanced }),
  }),
  {
    name: "config-view",
    version: 1,
    area: "local",
    partialize: ({ activeTab, showAdvanced }) => ({ activeTab, showAdvanced }),
    sanitize: sanitizeConfigView,
    legacy: { read: readLegacyShowAdvanced, discard: discardLegacyShowAdvanced },
  }
);

/** Subscribes to the configuration page's active tab. */
export function useConfigActiveTab() {
  const activeTab = useConfigViewStore((state) => state.activeTab);
  const setActiveTab = useConfigViewStore((state) => state.setActiveTab);
  return { activeTab, setActiveTab };
}

/** Subscribes to the configuration page's "show advanced" switch. */
export function useConfigShowAdvanced() {
  const showAdvanced = useConfigViewStore((state) => state.showAdvanced);
  const setShowAdvanced = useConfigViewStore((state) => state.setShowAdvanced);
  return { showAdvanced, setShowAdvanced };
}
