# Release Procedure for merge-mentor

This document describes the process for creating and publishing a new release of merge-mentor.

## Version Numbering

merge-mentor follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html):

- **MAJOR** (e.g., 2.0.0) - Breaking changes that are incompatible with previous versions
- **MINOR** (e.g., 1.28.0) - New features added in a backward-compatible manner
- **PATCH** (e.g., 1.27.1) - Bug fixes and non-functional improvements

Current version can be found in `package.json`.

## Release Checklist

### Step 1: Prepare Changes

Ensure all feature work is complete and committed:

```bash
# View current status
git status

# Commit any remaining changes
git add <files>
git commit -m "feat: description of feature"
```

### Step 2: Update CHANGELOG

Move changes from `[Unreleased]` section to a new versioned section in `CHANGELOG.md`:

```markdown
## [Unreleased]

## [X.Y.Z] - YYYY-MM-DD

### Added

- Feature 1
- Feature 2

### Changed

- Change 1

### Fixed

- Bug fix 1
```

**Commit this change:**

```bash
git add CHANGELOG.md
git commit -m "chore: prepare release for version X.Y.Z

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Step 3: Verify Build and Tests

Run full verification before releasing:

```bash
pnpm check
```

This runs:

- `pnpm build` - TypeScript compilation and production build
- `pnpm test` - Unit tests
- `pnpm lint` - Formatting and linting checks

**All checks must pass before proceeding.**

### Step 4: Bump Version

Use `pnpm version` to automatically:

- Update `package.json` version
- Create a git tag (e.g., `v1.28.0`)
- Create a version commit

```bash
# For minor version bump (features)
pnpm version minor

# For patch version bump (bug fixes)
pnpm version patch

# For major version bump (breaking changes)
pnpm version major
```

This command:

1. Updates `package.json` version field
2. Creates a commit with message "X.Y.Z"
3. Creates an annotated git tag `vX.Y.Z`

**Note:** This will run `pnpm check` as a pre-version hook.

### Step 5: Push to Repository

Push both the version commit and the tag to origin:

```bash
# Push the tag
git push origin vX.Y.Z

# Push the main branch
git push origin main
```

**Note:** A pre-push hook runs tests. If tests fail due to vitest configuration issues unrelated to your changes, use `--no-verify`:

```bash
git push origin vX.Y.Z --no-verify
git push origin main --no-verify
```

## Release Verification

After pushing the release:

1. **Verify on GitHub:**
   - Navigate to https://github.com/archerax/merge-mentor
   - Check that the tag `vX.Y.Z` appears in the Releases section
   - Verify the CHANGELOG and README are updated

2. **Verify Package Published:**
   - Check npm: https://www.npmjs.com/package/merge-mentor
   - Confirm new version appears in the package registry

3. **Verify GitHub Release:**
   - A GitHub release should be automatically created from the tag
   - CHANGELOG entry for that version should be included

## Example: Complete Release Flow

```bash
# 1. Ensure all changes are committed
git status  # Should be clean

# 2. Update CHANGELOG.md with unreleased changes
# - Move changes from [Unreleased] to new [X.Y.Z] section
# - Use today's date
nano CHANGELOG.md

# 3. Commit CHANGELOG update
git add CHANGELOG.md
git commit -m "chore: prepare release for version X.Y.Z

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"

# 4. Verify everything works
pnpm check

# 5. Bump version (choose one)
pnpm version minor    # For features (1.27.0 → 1.28.0)
pnpm version patch    # For fixes (1.27.0 → 1.27.1)

# 6. Push to origin
git push origin vX.Y.Z --no-verify
git push origin main --no-verify

# 7. Verify on GitHub
# Open: https://github.com/archerax/merge-mentor/releases
```

## CHANGELOG Format

Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format:

**Allowed Sections:**

- `Added` - New features
- `Changed` - Changes to existing functionality
- `Deprecated` - Soon-to-be removed features
- `Removed` - Removed features
- `Fixed` - Bug fixes
- `Security` - Security vulnerability fixes

**Example Entry:**

```markdown
## [1.28.0] - 2026-04-17

### Added

- New specialist review type for database optimization

### Changed

- **Default AI Timeout**: Increased from 5 minutes to 1 hour
  - Provides more time for complex PRs
  - Reduces timeout errors

### Fixed

- Bug in token validation for Copilot SDK

### Security

- Updated dependencies to patch vulnerability in lodash
```

## Troubleshooting

### Tests Fail During Pre-Push Hook

If vitest configuration errors occur during push (unrelated to code changes):

```bash
# Push with --no-verify to skip the pre-push hook
git push origin vX.Y.Z --no-verify
git push origin main --no-verify
```

### Undo a Version Bump

If you need to undo a version bump before pushing:

```bash
# Undo the last commit and tag
git reset --soft HEAD~1
git tag -d vX.Y.Z

# Fix the issue and try again
```

### Revert a Released Version

If a release needs to be reverted after pushing:

1. Revert the version commit (not recommended - breaks continuity)
2. Or create a new patch release with fixes

Prefer creating new releases to maintain version history integrity.

## Automation

GitHub Actions can automate release steps:

1. Publish to npm registry on tag push
2. Create GitHub releases with changelogs
3. Update documentation sites

Check `.github/workflows/` for CI/CD configuration.

## Questions?

Refer to:

- [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
- [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
- [pnpm version documentation](https://pnpm.io/cli/version)
