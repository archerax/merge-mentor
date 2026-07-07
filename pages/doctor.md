---
layout: default
title: Doctor Command
---

# `doctor` Command

The `doctor` command is a diagnostic tool that checks AI provider CLI installations and configuration. Use it to ensure that your environment variables, authentication credentials, and CLI dependencies are correctly configured before running reviews or fixes.

## Usage

```bash
# Check all available providers and system configurations
merge-mentor doctor

# Check configuration for a specific provider
merge-mentor doctor --provider copilot
merge-mentor doctor --provider opencode
merge-mentor doctor --provider claude-agent-sdk
```

---

## Options

| Option                  | Description                                                               |
| ----------------------- | ------------------------------------------------------------------------- |
| `--provider <provider>` | Check a specific provider (`copilot`, `opencode`, or `claude-agent-sdk`). |
