# Release Process

This document outlines the steps to release a new version of `merge-mentor`.

## Prerequisites

- Ensure you have write access to the repository.
- Ensure your local repository is up to date with `main`.

## Release Steps

### 1. Verification (Local)

Before tagging a release, it is recommended to run the checks locally to ensure the CI pipeline will pass.

```bash
# Install dependencies
pnpm install

# Run all checks
pnpm run check

# Run build to verify
pnpm run build
```

### 2. Update Version

#### Update `package.json`

Bump the version number in `package.json` according to [Semantic Versioning](https://semver.org/).

#### Update `CHANGELOG.md`

1.  Locate the `[Unreleased]` section.
2.  Rename it to the new version and add the current date (format: `YYYY-MM-DD`).
    *   Example: `## [1.9.0] - 2026-01-11`
3.  Create a new empty `## [Unreleased]` section at the top of the list.

### 3. Commit Changes

Commit the version bump and changelog updates.

```bash
git add package.json CHANGELOG.md
git commit -m "chore: release vX.Y.Z"
```

*Replace `X.Y.Z` with the actual version number.*

### 4. Tag the Release

Create a git tag for the new version. **The tag must start with `v`**.

```bash
git tag vX.Y.Z
```

*Example: `git tag v1.9.0`*

### 5. Push Changes

Push the commit and the tag to the remote repository.

```bash
git push && git push --tags
```

## CI/CD Pipeline

Once the tag is pushed, the GitHub Action defined in `.github/workflows/release.yml` will automatically:

1.  Checkout the code.
2.  Install dependencies and run tests/linting.
3.  Build the project.
4.  Create a tarball (`pnpm pack`).
5.  Parse `CHANGELOG.md` to extract the release notes for this version.
6.  Create a **GitHub Release** with the extracted notes and attach the package tarball.

## Post-Release

- Verify that the GitHub Release was created successfully.
- If necessary, publish to npm manually (if not handled by CI in the future). Currently, the project is `UNLICENSED` and set as `private` or meant for direct usage/global install from source/tarball.
