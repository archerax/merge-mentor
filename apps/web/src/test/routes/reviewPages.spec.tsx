// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithMantine } from "../renderWithMantine.js";
import { optionsOf, resetRouteState, routeState } from "../routerMock.js";

vi.mock("@tanstack/react-router", async () => (await import("../routerMock.js")).routerMock);

interface RunnerProps {
  readonly runId?: string;
  readonly onRunCreated?: (runId: string) => void;
  readonly kind?: string;
  readonly endpoint?: string;
  readonly actionLabel?: string;
  readonly renderResult?: (summary: never) => unknown;
}

function Runner(name: string) {
  return function MockRunner(props: RunnerProps) {
    return (
      <div>
        <span>{`${name} run=${props.runId ?? "none"} kind=${props.kind ?? "-"} endpoint=${props.endpoint ?? "-"} result=${typeof props.renderResult}`}</span>
        <button onClick={() => props.onRunCreated?.("new-run")}>create run</button>
      </div>
    );
  };
}

vi.mock("../../components/ReviewRunner.js", () => ({ ReviewRunner: Runner("pr") }));
vi.mock("../../components/PrdReviewRunner.js", () => ({ PrdReviewRunner: Runner("prd") }));
vi.mock("../../components/WorkItemReviewRunner.js", () => ({
  WorkItemReviewRunner: Runner("work-item"),
  PBIReviewResult: () => null,
  ProjectReviewResult: () => null,
}));

const routes = {
  review: (await import("../../routes/review.js")).Route,
  prd: (await import("../../routes/prd.js")).Route,
  pbi: (await import("../../routes/pbi.js")).Route,
  project: (await import("../../routes/project.js")).Route,
};

const cases = [
  {
    name: "review",
    title: "PR Review",
    marker: "pr run=",
    kind: "-",
    endpoint: "-",
    result: "undefined",
  },
  {
    name: "prd",
    title: "PRD / FRD Review",
    marker: "prd run=",
    kind: "-",
    endpoint: "-",
    result: "undefined",
  },
  {
    name: "pbi",
    title: "PBI Review",
    marker: "work-item run=",
    kind: "pbi",
    endpoint: "/api/pbi/stream",
    result: "function",
  },
  {
    name: "project",
    title: "Project Review",
    marker: "work-item run=",
    kind: "project",
    endpoint: "/api/project/stream",
    result: "function",
  },
] as const;

describe.each(cases)("$name route", (testCase) => {
  const route = routes[testCase.name];
  const Page = optionsOf(route).component;

  beforeEach(() => {
    resetRouteState();
  });

  it("keeps a run id from the URL", () => {
    expect(optionsOf(route).validateSearch({ run: "abc" })).toEqual({ run: "abc" });
  });

  it.each([[{}], [{ run: "" }], [{ run: 7 }]])("drops an unusable run id %j", (search) => {
    expect(optionsOf(route).validateSearch(search)).toEqual({ run: undefined });
  });

  it("renders the page heading and passes the run id to the runner", () => {
    routeState.search = { run: "existing" };
    renderWithMantine(<Page />);

    expect(screen.getByRole("heading", { name: testCase.title })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`^${testCase.marker}existing`))).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(`kind=${testCase.kind} endpoint=${testCase.endpoint} result=${testCase.result}$`)
      )
    ).toBeInTheDocument();
  });

  it("starts without a run id", () => {
    renderWithMantine(<Page />);

    expect(screen.getByText(new RegExp(`^${testCase.marker}none`))).toBeInTheDocument();
  });

  it("stores a newly created run id in the URL, replacing the history entry", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    renderWithMantine(<Page />);

    await userEvent.setup().click(screen.getByRole("button", { name: "create run" }));

    expect(routeState.navigate).toHaveBeenCalledTimes(1);
    const options = routeState.navigate.mock.calls[0][0];
    expect(options.replace).toBe(true);
    expect(options.search({ other: "kept" })).toEqual({ other: "kept", run: "new-run" });
  });
});
