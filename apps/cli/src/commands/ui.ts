import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { consoleOutputWriter } from "@merge-mentor/shared/ports/index.js";
import { InvalidArgumentError } from "commander";

import type { UiOptions } from "./types.js";

/** Default port for the dashboard server. */
export const DEFAULT_UI_PORT = 3000;

/**
 * Default host for the dashboard server.
 *
 * Binding to loopback keeps the unauthenticated dashboard reachable only from
 * the local machine. Pass `--host` to opt in to a broader bind (e.g. `0.0.0.0`
 * inside a container).
 */
export const DEFAULT_UI_HOST = "127.0.0.1";

const MIN_UI_PORT = 1;
const MAX_UI_PORT = 65535;

/**
 * Returns whether a bind host refers to the local machine.
 *
 * @param host - Candidate bind host
 * @returns `true` for loopback aliases (`127.0.0.1`, `localhost`, `::1`)
 */
function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * Decides whether the command should open the dashboard in a browser.
 *
 * Opening is suppressed when the user passed `--no-open`, when stdout is not an
 * interactive terminal (CI, pipes), or when the server is bound to a
 * non-loopback address (for example a container publishing on `0.0.0.0`).
 *
 * @param options - Resolved UI command options
 * @param host - Resolved bind host
 * @param isTTY - Whether stdout is attached to an interactive terminal
 * @returns `true` when the dashboard should be opened in the default browser
 */
export function shouldOpenBrowser(options: UiOptions, host: string, isTTY: boolean): boolean {
  if (options.open === false) {
    return false;
  }
  if (!isTTY) {
    return false;
  }
  return isLoopbackHost(host);
}

/**
 * Validates a dashboard port number.
 *
 * @param port - Candidate TCP port
 * @returns The validated port
 * @throws If `port` is not an integer within the 1-65535 range
 */
function validateUiPort(port: number): number {
  if (!Number.isInteger(port) || port < MIN_UI_PORT || port > MAX_UI_PORT) {
    throw new InvalidArgumentError(
      `Port must be an integer between ${MIN_UI_PORT} and ${MAX_UI_PORT}.`
    );
  }
  return port;
}

/**
 * Parses and validates a `--port` value for Commander.
 *
 * @param value - Raw CLI argument
 * @returns The validated port
 * @throws If `value` is not a valid port number
 */
export function parseUiPort(value: string): number {
  return validateUiPort(Number.parseInt(value, 10));
}

/**
 * Candidate locations for the prebuilt dashboard server entry, checked in
 * order:
 * - `dist/web/server/index.mjs` relative to the bundled CLI (`dist/cli.js`)
 * - `../../../../apps/web/.output/server/index.mjs` when running from source
 *   (`apps/cli/src/commands/ui.ts`)
 *
 * @returns Absolute path to the Nitro server entry, or `undefined` if absent
 */
function resolveServerEntry(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "web", "server", "index.mjs"),
    join(here, "..", "..", "..", "..", "apps", "web", ".output", "server", "index.mjs"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

/**
 * Best-effort attempt to open a URL in the platform default browser.
 *
 * @param url - URL to open
 */
function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(command, [url], {
      stdio: "ignore",
      detached: true,
      shell: process.platform === "win32",
    }).unref();
  } catch {
    // Opening the browser is a convenience; ignore failures.
  }
}

/**
 * Executes the `ui` command: launches the prebuilt `@merge-mentor/web`
 * dashboard server and streams its output to the current terminal.
 *
 * The dashboard is built with Nitro (`node-server` preset) and shipped inside
 * the package as `dist/web`, so this works from an npm install without a Vite
 * dev server or the web app's runtime dependencies. Keeps running until the
 * server exits (or the user presses Ctrl+C).
 *
 * @param options - UI command options (`port`, `host`, `open`)
 * @returns Resolves once the dashboard server process has exited
 * @throws If the prebuilt dashboard cannot be found or the process fails to start
 */
export async function executeUiCommand(options: UiOptions): Promise<void> {
  const output = consoleOutputWriter;
  const port = options.port === undefined ? DEFAULT_UI_PORT : validateUiPort(options.port);
  const host = options.host ?? DEFAULT_UI_HOST;
  const entry = resolveServerEntry();

  if (!entry) {
    throw new Error(
      "The web dashboard is not bundled in this install. Build it with `pnpm build`, or run " +
        "the development server with `pnpm --filter @merge-mentor/web dev`."
    );
  }

  const token = randomBytes(24).toString("base64url");
  const url = `http://${host}:${port}/?token=${token}`;
  output.log(
    `\n🖥️  Starting merge-mentor dashboard. Open this URL (it contains a one-time access token):\n   ${url}\n`
  );

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [entry], {
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(port),
        HOST: host,
        NITRO_HOST: host,
        NITRO_PORT: String(port),
        MM_UI_TOKEN: token,
        MM_UI_ALLOWED_HOSTS: host,
      },
    });

    child.on("error", (error) => {
      rejectPromise(new Error(`Failed to start the dashboard: ${error.message}`));
    });
    child.on("exit", (code) => {
      if (code && code !== 0) {
        rejectPromise(new Error(`Dashboard exited with code ${code}`));
        return;
      }
      resolvePromise();
    });

    if (shouldOpenBrowser(options, host, process.stdout.isTTY === true)) {
      setTimeout(() => openBrowser(url), 1500);
    }
  });
}
