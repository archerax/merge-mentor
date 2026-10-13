---
layout: default
title: UI Command
---

# `ui` Command

The `ui` command launches the local web dashboard for interactive reviews. It runs the prebuilt dashboard server that ships inside the package, so it works from an npm install without cloning the repository or running a Vite dev server.

## Usage

```bash
# Launch the dashboard on the default port (3000) and open it in the browser
merge-mentor ui

# Use a custom port without opening a browser
merge-mentor ui --port 4321 --no-open

# Bind to all interfaces (e.g. inside a container)
merge-mentor ui --host 0.0.0.0 --no-open
```

The command keeps running until the server exits or you press `Ctrl+C`.

By default the dashboard binds to `127.0.0.1` (loopback) and is reachable only
from the local machine. The dashboard has **no authentication**, so avoid
binding it to a public interface unless you have another layer of access
control in front of it.

---

## Options

| Option          | Description                                                                          |
| --------------- | ------------------------------------------------------------------------------------ |
| `--port <port>` | Port for the dashboard server. Must be an integer from 1 to 65535. Default: `3000`.  |
| `--host <host>` | Bind the dashboard server to a specific host (e.g. `0.0.0.0`). Default: `127.0.0.1`. |
| `--open`        | Open the dashboard in the default browser once it is ready. Default behavior.        |
| `--no-open`     | Do not open the dashboard in the default browser.                                    |

The browser is not opened when stdout is not an interactive terminal (for
example in CI) or when the server is bound to a non-loopback host.

---

## Troubleshooting

If the command reports that the web dashboard is not bundled, the install is missing its prebuilt assets. From a repository checkout, run `pnpm build` to build and bundle the dashboard. For local development of the dashboard itself, run `pnpm --filter @merge-mentor/web dev`.
