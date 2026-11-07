import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** An in-memory stand-in for `window.sessionStorage` / `window.localStorage`. */
class FakeStorage {
  readonly items = new Map<string, string>();

  getItem(name: string): string | null {
    return this.items.get(name) ?? null;
  }

  setItem(name: string, value: string): void {
    this.items.set(name, value);
  }

  removeItem(name: string): void {
    this.items.delete(name);
  }

  read(name: string): unknown {
    const raw = this.items.get(name);
    return raw === undefined ? undefined : JSON.parse(raw);
  }

  write(name: string, state: unknown, version = 1): void {
    this.items.set(name, JSON.stringify({ state, version }));
  }
}

let session: FakeStorage;
let local: FakeStorage;

/** Fresh store modules, so each test starts from defaults with nothing hydrated. */
async function loadStores() {
  const persisted = await import("./persisted.js");
  const reviewForms = await import("./reviewForms.js");
  const audit = await import("./auditFilters.js");
  const reports = await import("./reportsView.js");
  const config = await import("./configView.js");
  const prd = await import("./prdOptions.js");
  return {
    hydrate: persisted.hydratePersistedStores,
    reviewForms: reviewForms.useReviewFormsStore,
    audit: audit.useAuditFiltersStore,
    reports: reports.useReportsViewStore,
    config: config.useConfigViewStore,
    prd: prd.usePrdOptionsStore,
  };
}

beforeEach(() => {
  vi.resetModules();
  session = new FakeStorage();
  local = new FakeStorage();
  vi.stubGlobal("window", { sessionStorage: session, localStorage: local });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("persisted stores", () => {
  it("does not read or write storage before hydration", async () => {
    session.write("merge-mentor:audit-filters", { severity: "error", query: "saved" });
    const { audit } = await loadStores();

    expect(audit.getState().severity).toBe("all");
    audit.getState().setQuery("typed early");

    expect(session.read("merge-mentor:audit-filters")).toEqual({
      state: { severity: "error", query: "saved" },
      version: 1,
    });
  });

  it("round-trips UI state through session storage", async () => {
    const first = await loadStores();
    first.hydrate();
    first.audit.getState().setSeverity("warn");
    first.audit.getState().setQuery("deploy");
    first.reports.getState().setQuery("checkout");
    first.reports.getState().setPick({ search: undefined, name: "review-1.md" });
    first.prd.getState().setDocumentType("frd");
    first.prd.getState().setAnnotate(true);

    vi.resetModules();
    const second = await loadStores();
    second.hydrate();

    expect(second.audit.getState()).toMatchObject({ severity: "warn", query: "deploy" });
    expect(second.reports.getState()).toMatchObject({
      query: "checkout",
      pick: { search: undefined, name: "review-1.md" },
    });
    expect(second.prd.getState()).toMatchObject({
      documentType: "frd",
      annotate: true,
    });
  });

  it("never saves what acts on the user's behalf or sends data to the AI provider", async () => {
    const stores = await loadStores();
    stores.hydrate();
    stores.reviewForms.getState().setInput("pr", "#7");
    stores.reviewForms.getState().setWrite("pr", true);
    stores.reviewForms.getState().setStrategy("pr", "deep");
    stores.prd.getState().setIncludeImages(true);
    stores.prd.getState().setAnnotate(true);

    const forms = (session.read("merge-mentor:review-forms") as { state: { forms: object } }).state
      .forms as Record<string, Record<string, unknown>>;
    expect(forms.pr).toEqual({ input: "#7", strategy: "deep", runs: null });
    expect(forms.pr).not.toHaveProperty("write");
    const prd = (session.read("merge-mentor:prd-options") as { state: Record<string, unknown> })
      .state;
    expect(prd).toEqual({ documentType: "prd", annotate: true });
    expect(prd).not.toHaveProperty("includeImages");

    // A hand-edited payload cannot switch them on either.
    session.write("merge-mentor:prd-options", { includeImages: true });
    vi.resetModules();
    const second = await loadStores();
    second.hydrate();
    expect(second.prd.getState().includeImages).toBe(false);
  });

  it("drops a saved review-runs count above the limit", async () => {
    session.write("merge-mentor:review-forms", {
      forms: { pr: { runs: 11 }, pbi: { runs: 10 } },
    });
    const stores = await loadStores();
    stores.hydrate();

    expect(stores.reviewForms.getState().forms.pr.runs).toBeNull();
    expect(stores.reviewForms.getState().forms.pbi.runs).toBe(10);
  });

  it("replaces a payload saved by another version instead of leaving it behind", async () => {
    session.write("merge-mentor:audit-filters", { severity: "error", query: "old" }, 0);
    const { hydrate, audit } = await loadStores();
    hydrate();

    expect(audit.getState()).toMatchObject({ severity: "all", query: "" });
    expect(session.read("merge-mentor:audit-filters")).toEqual({
      state: { severity: "all", query: "" },
      version: 1,
    });
  });

  it("keeps the configuration view in local storage", async () => {
    const first = await loadStores();
    first.hydrate();
    first.config.getState().setActiveTab("Tuning");
    first.config.getState().setShowAdvanced(true);

    expect(local.read("merge-mentor:config-view")).toEqual({
      state: { activeTab: "Tuning", showAdvanced: true },
      version: 1,
    });
    expect(session.items.has("merge-mentor:config-view")).toBe(false);

    vi.resetModules();
    const second = await loadStores();
    second.hydrate();
    expect(second.config.getState()).toMatchObject({ activeTab: "Tuning", showAdvanced: true });
  });

  it("carries over a 'show advanced' choice saved under the old key", async () => {
    local.setItem("merge-mentor:config:show-advanced", "true");
    const { hydrate, config } = await loadStores();
    hydrate();

    expect(config.getState().showAdvanced).toBe(true);
    expect(local.read("merge-mentor:config-view")).toEqual({
      state: { activeTab: null, showAdvanced: true },
      version: 1,
    });
    expect(local.items.has("merge-mentor:config:show-advanced")).toBe(false);

    vi.resetModules();
    const second = await loadStores();
    second.hydrate();
    expect(second.config.getState().showAdvanced).toBe(true);
  });

  it("does not bring back a legacy 'show advanced' choice after it was turned off", async () => {
    local.setItem("merge-mentor:config:show-advanced", "true");
    const first = await loadStores();
    first.hydrate();
    first.config.getState().setShowAdvanced(false);

    vi.resetModules();
    const second = await loadStores();
    second.hydrate();
    expect(second.config.getState().showAdvanced).toBe(false);
  });

  it("hydrates a store created after the app has hydrated straight away", async () => {
    session.write("merge-mentor:prd-options", { documentType: "frd" });
    const persisted = await import("./persisted.js");
    persisted.hydratePersistedStores();

    const { usePrdOptionsStore } = await import("./prdOptions.js");
    expect(usePrdOptionsStore.getState().documentType).toBe("frd");
  });

  it("never saves the review forms' write toggle", async () => {
    const first = await loadStores();
    first.hydrate();
    first.reviewForms.getState().setInput("pr", "https://example.test/pr/1");
    first.reviewForms.getState().setStrategy("pr", "deep");
    first.reviewForms.getState().setRuns("pr", 3);
    first.reviewForms.getState().setWrite("pr", true);

    const saved = session.read("merge-mentor:review-forms") as {
      state: { forms: Record<string, Record<string, unknown>> };
    };
    expect(saved.state.forms.pr).toEqual({
      input: "https://example.test/pr/1",
      strategy: "deep",
      runs: 3,
    });

    vi.resetModules();
    const second = await loadStores();
    second.hydrate();
    expect(second.reviewForms.getState().forms.pr).toEqual({
      input: "https://example.test/pr/1",
      write: false,
      strategy: "deep",
      runs: 3,
    });
  });

  it("ignores a write flag planted in storage", async () => {
    session.write("merge-mentor:review-forms", { forms: { pbi: { input: "42", write: true } } });
    const { hydrate, reviewForms } = await loadStores();
    hydrate();

    expect(reviewForms.getState().forms.pbi).toEqual({
      input: "42",
      write: false,
      strategy: null,
      runs: null,
    });
  });

  it("drops malformed fields and keeps the valid ones", async () => {
    session.write("merge-mentor:review-forms", {
      forms: { pr: { input: 7, strategy: "reckless", runs: 0 }, project: { runs: 2 } },
    });
    session.write("merge-mentor:audit-filters", { severity: "fatal", query: "keep" });
    session.write("merge-mentor:reports-view", { query: ["x"], pick: { name: 5 } });
    session.write("merge-mentor:prd-options", { documentType: "doc", annotate: "yes" });
    local.write("merge-mentor:config-view", { activeTab: 3, showAdvanced: true });
    const stores = await loadStores();
    stores.hydrate();

    expect(stores.reviewForms.getState().forms.pr).toEqual({
      input: "",
      write: false,
      strategy: null,
      runs: null,
    });
    expect(stores.reviewForms.getState().forms.project.runs).toBe(2);
    expect(stores.audit.getState()).toMatchObject({ severity: "all", query: "keep" });
    expect(stores.reports.getState()).toMatchObject({ query: "", pick: null });
    expect(stores.prd.getState()).toMatchObject({
      documentType: "prd",
      includeImages: false,
      annotate: false,
    });
    expect(stores.config.getState()).toMatchObject({ activeTab: null, showAdvanced: true });
  });

  it("falls back to defaults for unparseable or non-object data", async () => {
    session.items.set("merge-mentor:audit-filters", "{not json");
    session.write("merge-mentor:prd-options", ["frd"]);
    const { hydrate, audit, prd } = await loadStores();
    hydrate();

    expect(audit.getState()).toMatchObject({ severity: "all", query: "" });
    expect(prd.getState().documentType).toBe("prd");

    // Hydration still finished, so new values are saved over the bad ones.
    audit.getState().setQuery("fresh");
    expect(session.read("merge-mentor:audit-filters")).toEqual({
      state: { severity: "all", query: "fresh" },
      version: 1,
    });
  });

  it("falls back to empty forms for review forms saved by another version", async () => {
    session.write("merge-mentor:review-forms", { forms: { pr: { input: "old" } } }, 0);
    const { hydrate, reviewForms } = await loadStores();
    hydrate();

    expect(reviewForms.getState().forms.pr.input).toBe("");
    expect(session.read("merge-mentor:review-forms")).toMatchObject({ version: 1 });
  });

  it("drops a saved report pick that names no report", async () => {
    session.write("merge-mentor:reports-view", {
      query: "q",
      pick: { search: "a.md", name: null },
    });
    const { hydrate, reports } = await loadStores();
    hydrate();

    expect(reports.getState()).toMatchObject({ query: "q", pick: null });
  });

  it("keeps working when storage is unavailable", async () => {
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("blocked");
      },
    });
    const { hydrate, audit } = await loadStores();
    hydrate();
    audit.getState().setQuery("still works");

    expect(audit.getState().query).toBe("still works");
  });

  it("works without a window, as during server rendering", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("window", undefined);
    expect(typeof window).toBe("undefined");
    const { hydrate, reports } = await loadStores();
    hydrate();
    reports.getState().setQuery("server");

    expect(reports.getState().query).toBe("server");
  });
});
