# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Report them privately via GitHub's private vulnerability reporting:

**[Report a vulnerability](https://github.com/archerax/merge-mentor/security/advisories/new)**

(Security tab → Advisories → Report a vulnerability)

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce, or a proof of concept
- Affected version(s), if known
- Any suggested remediation (optional)

### What to expect

- **Acknowledgement within 3 business days** of your report.
- **Severity assessment within 7 days**, with a triage decision shared with you.
- **Critical vulnerabilities**: a patch release is targeted within 7 days of triage.
- **Credit** in the GitHub Security Advisory and release notes, unless you prefer to remain anonymous.

If you haven't received an acknowledgement within 3 business days, please follow up on the same advisory thread.

## Supported Versions

Security fixes are applied to the **latest release line only** and ship as patch releases. Older versions are not backported — please upgrade to the latest release.

| Version           | Supported          |
| ----------------- | ------------------ |
| Latest release    | :white_check_mark: |
| Any older release | :x:                |

Fixes are announced via [GitHub Security Advisories](https://github.com/archerax/merge-mentor/security/advisories) and the [CHANGELOG](./CHANGELOG.md).

## Scope

Merge Mentor runs on developer workstations and CI runners with user-supplied credentials (GitHub/Azure DevOps PATs, AI provider API keys), and it feeds untrusted PR content (comments, descriptions, diffs) to AI agents. The following are treated as security vulnerabilities:

**In scope:**

- **Credential or token exposure** — e.g., platform tokens or API keys sent to unintended third parties, logged, or leaked into prompts or comments.
- **Prompt-injection vectors** — untrusted PR content bypassing the tool's untrusted-content defenses (security preamble, content delimiters) to hijack the AI agent into unintended actions.
- **Command injection / unintended tool access** — the AI agent gaining shell execution or file-write access beyond the permissions the user configured.
- **Supply-chain compromise of merge-mentor itself** — e.g., tampering with the build or npm publish pipeline.

**Out of scope:**

- Vulnerabilities in third-party AI providers or their SDKs themselves — please report those upstream. (If Merge Mentor _misconfigures or misuses_ them, that is in scope here.)
- Attacks requiring an already-compromised local machine, CI runner, or the victim's own credentials.
- AI output quality issues (inaccurate or incomplete reviews) — please use a regular GitHub issue for those.
- Volumetric denial-of-service (e.g., excessive API requests against rate-limited services).

## Disclosure Policy

We follow **coordinated disclosure**:

1. You report privately via a GitHub Security Advisory (see above).
2. We confirm, develop a fix, and prepare a patch release.
3. We publish the patch and the advisory together, crediting you.
4. We ask that you do not disclose the vulnerability publicly until a fix is available, or **90 days** from our acknowledgement — whichever comes first.

We will keep you informed of progress and will tell you if we cannot meet the timelines above.

## Using Merge Mentor Securely

- **Dry-run is the default** — reviews only post comments when you pass `--write`.
- **Use least-privilege tokens** — scope PATs to the repositories and permissions Merge Mentor actually needs.
- **Pin versions in CI** — and review the CHANGELOG before upgrading.
- **Audit logging is on by default** — see the [Configuration Guide](./docs/configuration.md) for details.
