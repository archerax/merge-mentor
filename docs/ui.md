---
layout: default
title: UI Command
---

# `ui` Command

The `ui` command launches the local web dashboard for interactive reviews. It runs the prebuilt dashboard server that ships inside the package, so it works from an npm install without cloning the repository or running a Vite dev server.

## Usage

```bash
# Launch the dashboard on the default port (3000)
merge-mentor ui

# Use a custom port and open it in the default browser
merge-mentor ui --port 4321 --open

# Bind to all interfaces (e.g. inside a container)
merge-mentor ui --host 0.0.0.0
```

The command keeps running until the server exits or you press `Ctrl+C`.

---

## Options

| Option          | Description                                                                         |
| --------------- | ----------------------------------------------------------------------------------- |
| `--port <port>` | Port for the dashboard server. Must be an integer from 1 to 65535. Default: `3000`. |
| `--host <host>` | Bind the dashboard server to a specific host (e.g. `0.0.0.0`).                      |
| `--open`        | Open the dashboard in the default browser once it is ready.                         |

---

## Troubleshooting

If the command reports that the web dashboard is not bundled, the install is missing its prebuilt assets. From a repository checkout, run `pnpm build` to build and bundle the dashboard. For local development of the dashboard itself, run `pnpm --filter @merge-mentor/web dev`.
