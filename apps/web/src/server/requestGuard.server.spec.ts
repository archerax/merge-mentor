import { describe, expect, it } from "vitest";

import {
  checkRequest,
  guardResponse,
  readGuardConfig,
  TOKEN_COOKIE,
  type RequestGuardConfig,
} from "./requestGuard.server.js";

const token = "t0ken-value";
const config: RequestGuardConfig = { allowedHosts: [], token };
const cookie = `${TOKEN_COOKIE}=${token}`;

function req(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const headers = { host: "127.0.0.1:4321", cookie, ...init.headers };
  return new Request(`http://127.0.0.1:4321${path}`, { ...init, headers });
}

describe("checkRequest", () => {
  it("allows a same-origin JSON POST with the token cookie", () => {
    const request = req("/api/review/post", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:4321" },
    });
    expect(checkRequest(request, config)).toEqual({ action: "allow" });
  });

  it("rejects a foreign Host (DNS rebinding)", () => {
    const result = checkRequest(req("/", { headers: { host: "attacker.example" } }), config);
    expect(result).toMatchObject({ action: "deny", status: 403 });
  });

  it("allows configured extra hosts", () => {
    const extra = { ...config, allowedHosts: ["dash.lan"] };
    expect(checkRequest(req("/", { headers: { host: "dash.lan:4321" } }), extra).action).toBe(
      "allow"
    );
  });

  it("rejects a foreign Origin on POST", () => {
    const request = req("/api/review/post", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
    });
    expect(checkRequest(request, config)).toMatchObject({ action: "deny", status: 403 });
  });

  it("rejects cross-site Fetch Metadata", () => {
    const request = req("/api/review/post", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
    });
    expect(checkRequest(request, config)).toMatchObject({ action: "deny", status: 403 });
  });

  it("rejects a text/plain API body", () => {
    const request = req("/api/review/stream", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "text/plain", origin: "http://127.0.0.1:4321" },
    });
    expect(checkRequest(request, config)).toMatchObject({ action: "deny", status: 415 });
  });

  it("rejects requests without the token", () => {
    const request = new Request("http://127.0.0.1:4321/api/review/runs/x", {
      headers: { host: "127.0.0.1:4321" },
    });
    expect(checkRequest(request, config)).toMatchObject({ action: "deny", status: 403 });
  });

  it("rejects a wrong token cookie", () => {
    const request = req("/", { headers: { cookie: `${TOKEN_COOKIE}=nope` } });
    expect(checkRequest(request, config)).toMatchObject({ action: "deny", status: 403 });
  });

  it("exchanges ?token= for a cookie and strips it from the URL", () => {
    const request = new Request(`http://127.0.0.1:4321/review?a=1&token=${token}`, {
      headers: { host: "127.0.0.1:4321" },
    });
    const result = checkRequest(request, config);
    expect(result).toEqual({ action: "authenticate", redirectTo: "/review?a=1" });
    if (result.action !== "authenticate") throw new Error("unreachable");
    const response = guardResponse(result, config);
    expect(response.status).toBe(303);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Strict");
  });

  it("skips the token check when no token is configured (dev server)", () => {
    const request = new Request("http://localhost:3000/", { headers: { host: "localhost:3000" } });
    expect(checkRequest(request, { allowedHosts: [], token: undefined }).action).toBe("allow");
  });
});

describe("readGuardConfig", () => {
  it("parses hosts and token from the environment", () => {
    expect(readGuardConfig({ MM_UI_ALLOWED_HOSTS: " A.lan ,b.lan", MM_UI_TOKEN: "x" })).toEqual({
      allowedHosts: ["a.lan", "b.lan"],
      token: "x",
    });
  });
});
