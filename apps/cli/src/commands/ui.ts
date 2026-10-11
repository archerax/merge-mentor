import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { consoleOutputWriter } from "@merge-mentor/shared/ports/index.js";
import { InvalidArgumentError } from "commander";

import type { UiOptions } from "./types.js";

/** Default port for the dashboard server. */
export const DEFAULT_UI_PORT = 3000;

const MIN_UI_PORT = 1;
const MAX_UI_PORT = 65535;

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
  const entry = resolveServerEntry();

  if (!entry) {
    throw new Error(
      "The web dashboard is not bundled in this install. Build it with `pnpm build`, or run " +
        "the development server with `pnpm --filter @merge-mentor/web dev`."
    );
  }

  const url = `http://localhost:${port}`;
  output.log(`\n🖥️  Starting merge-mentor dashboard on ${url}\n`);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [entry], {
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(port),
        ...(options.host ? { HOST: options.host } : {}),
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

    if (options.open) {
      setTimeout(() => openBrowser(url), 1500);
    }
  });
}
