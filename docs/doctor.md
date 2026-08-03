---
layout: default
title: Doctor Command
---

# `doctor` Command

The `doctor` command is a diagnostic tool that checks AI provider configuration. The Copilot CLI runtime is bundled with the Copilot SDK; set `COPILOT_CLI_PATH` only when an alternate runtime is intentionally configured.

## Usage

```bash
# Check all available providers and system configurations
merge-mentor doctor

# Check configuration for a specific provider
merge-mentor doctor --provider copilot
merge-mentor doctor --provider opencode
```

---

## Options

| Option                  | Description                                                  |
| ----------------------- | ------------------------------------------------------------ |
| `--provider <provider>` | Check a specific provider (`copilot-sdk` or `opencode-sdk`). |
