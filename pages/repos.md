---
layout: default
title: Repos Command
---

# `repos` Command

The `repos` command manages cloned repositories that Merge Mentor stores locally. These cloned repositories are used for code context loading when performing reviews or applying fixes.

## Usage

```bash
# List all locally cached/cloned repositories
merge-mentor repos --list

# Remove all cloned repositories to free up space
merge-mentor repos --clean

# Remove a specific cloned repository folder
merge-mentor repos --clean-repo my-cloned-repo-folder

# List repositories in a custom temporary path
merge-mentor repos --list --temp-path /custom/temp/path
```

---

## Options

| Option                | Description                                              | Env Variable   | Default          |
| --------------------- | -------------------------------------------------------- | -------------- | ---------------- |
| `--list`              | List all cloned repositories.                            | -              | `false`          |
| `--clean`             | Remove all cloned repositories.                          | -              | `false`          |
| `--clean-repo <name>` | Remove a specific cloned repository.                     | -              | -                |
| `--temp-path <path>`  | Base path for temporary files (cache, diffs, logs, etc.) | `MM_TEMP_PATH` | `./.mergementor` |
