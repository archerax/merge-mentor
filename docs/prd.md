---
layout: default
title: PRD Command
---

# `prd` Command

The `prd` command gives a first-pass review of a Word requirements document, either a **Product Requirements Document (PRD)** or a **Functional Requirements Document (FRD)**, before development starts. It looks for gaps, unclear wording, contradictions and requirements that cannot be tested, and writes a plain-language report for the document's author.

It is written for product owners and business analysts. You do not need a code repository, a GitHub or Azure DevOps token, or any development tools: just the `.docx` file and access to your team's AI provider.

## Usage

```bash
# Review a PRD (the default document type)
merge-mentor prd checkout-redesign.docx

# Review an FRD
merge-mentor prd payments-frd.docx --type frd

# Use a specific model
merge-mentor prd checkout-redesign.docx --ai-model claude-sonnet-4.6
```

When the review finishes, the command prints the readiness verdict, the number of issues at each severity, and where the report was saved. Open the Markdown report in any editor, or launch the dashboard with `merge-mentor ui` and open it from the **Reports** page.

---

## Options

### General Options

| Option               | Description                                                                                  | Env Variable   | Default          |
| -------------------- | -------------------------------------------------------------------------------------------- | -------------- | ---------------- |
| `<file>`             | Path to the Word document (`.docx`) to review                                                | -              | -                |
| `--type <type>`      | Document type, which picks the review checklist: `prd` or `frd`                              | -              | `prd`            |
| `--include-images`   | Also review images in the document (see [Images](#images))                                   | -              | `false`          |
| `--temp-path <path>` | Base folder for reports and run data (see [Where files are stored](#where-files-are-stored)) | `MM_TEMP_PATH` | `./.mergementor` |

### AI Provider Configuration

| Option                    | Description                                  | Env Variable       | Default       |
| ------------------------- | -------------------------------------------- | ------------------ | ------------- |
| `--provider <provider>`   | AI provider (`copilot-sdk`, `opencode-sdk`). | `MM_AI_PROVIDER`   | `copilot-sdk` |
| `--copilot-token <token>` | Copilot GitHub token                         | `MM_COPILOT_TOKEN` | -             |
| `--ai-timeout <ms>`       | Timeout in milliseconds for each AI request  | `MM_AI_TIMEOUT`    | -             |
| `--ai-model <model>`      | Model name for the active AI provider        | `MM_AI_MODEL`      | -             |
| `--ai-base-url <url>`     | OpenAI-compatible API base URL for BYOK      | `MM_AI_BASE_URL`   | -             |
| `--ai-api-key <key>`      | API key for BYOK                             | `MM_AI_API_KEY`    | -             |

See the [Configuration Guide](./configuration.md) for setting these up once with environment variables.

The command exits with code `0` when the review completes (whatever the verdict) and `1` on an error, such as a missing file, an unsupported file or an AI provider failure.

---

## What Gets Reviewed

The document is split into its sections (using its headings) and each section is reviewed against the checklist for its type. A final pass then looks across the whole document for contradictions between sections and anything missing.

**PRD** (`--type prd`)

1. **Problem, users and goals**: is it clear what problem is being solved, for whom, and how success will be measured?
2. **Scope**: what is in and out of scope, and the assumptions and dependencies.
3. **Ambiguity and contradictions**: vague terms and statements that conflict with each other.
4. **Non-functional needs**: security, performance, compliance, accessibility and scalability.

**FRD** (`--type frd`)

1. **Requirement quality**: is each requirement single, testable, unambiguous and uniquely identified?
2. **Acceptance criteria**: can each requirement be measured and verified?
3. **Edge cases and error handling**: what happens on invalid input, failures and other unhappy paths?

Tracked changes are reviewed as if accepted (insertions kept, deletions dropped). Existing Word comments are read as context but are not repeated as findings.

## The Report

Each report contains:

- **A readiness verdict**: _Ready for development_, _Needs work before development_ (one or more Major issues) or _Not ready for development_ (one or more Blockers), with a short summary.
- **Findings grouped by severity**:
  - **Blocker**: development cannot sensibly start, or the team would likely build the wrong thing.
  - **Major**: likely to cause rework, delays or disagreement later; should be fixed first.
  - **Minor**: a wording or clarity improvement that does not block anyone.

  Every finding quotes the exact text it is about, explains the problem in plain language, suggests an improvement and, where useful, asks you a question.

- **A "Not reviewed" list**: anything the review did not cover, so you know where to look yourself. This includes images that were not reviewed (with the reason), sections the AI could not review, parts beyond the review limit for very long documents, and content the reader could not extract.

Before the report is written, every finding is double-checked: findings whose quote cannot be found in the document, duplicates, and findings that do not hold up on a second look are removed.

The review is an automated first pass. Use it alongside, not instead of, review by your team.

## Supported Files

- Word documents in `.docx` format, up to **20 MB**. Larger files are rejected before anything is read.
- Legacy `.doc` files and password-protected documents are not supported: save them as an unprotected `.docx` first.
- Headers, footers, footnotes and endnotes are not reviewed.
- Documents without headings are still reviewed, in fixed-size parts instead of by section.

## Images

By default, images are not sent to the AI provider. They are listed under "Not reviewed" in the report, with their alt text and section, so the review cost and behaviour are predictable.

`--include-images` (or **Include images** on the dashboard) opts in to image review. Each image is reviewed together with the text of the part of the document it appears in, looking for diagrams, flows or mock-ups that contradict the text, show things the text never describes, or cannot be understood on their own. Findings about an image name the image (for example `img3`, with its alt text) and quote the text next to it, and are double-checked like every other finding.

Image review needs a model that accepts images. Before sending anything, Merge Mentor asks the provider whether the configured model does:

- **`copilot-sdk`**: the model must be set explicitly (`--ai-model` / `MM_AI_MODEL`) and listed as accepting images ("vision") in your Copilot model list. With automatic model selection or a custom `--ai-base-url` endpoint, support cannot be checked, so images are not sent.
- **`opencode-sdk`**: the model must be set as `provider/model` and listed by OpenCode as accepting image input.

If the model does not accept images, the review still runs on the text: the command prints a warning, the dashboard shows a note, and every image is listed under "Not reviewed" with the reason.

To keep cost and time predictable, at most **20 images** per document are reviewed, each up to **5 MB** (or the model's own limit, if lower), in PNG, JPEG, GIF or WebP format (or the formats the model reports). Repeated copies of the same picture are reviewed once. Images beyond these limits, in other formats (such as EMF/WMF drawings) or linked rather than embedded are listed under "Not reviewed" with the reason.

The images that are sent are first saved in the run's folder (`.mergementor/prd/<run-id>/images/`) and are removed when you delete the run.

---

## Confidentiality

The `prd` command follows the same local-only approach as every other Merge Mentor command:

- The document is read on your computer and its text is sent only to **your configured AI provider**. Nothing is sent to Merge Mentor or any other service, and there is no telemetry.
- The AI is given no tools to change files or run commands while it reviews the document.
- Everything the review produces stays on your computer, under the `.mergementor` folder in the directory you ran the command from (or the folder set with `--temp-path` / `MM_TEMP_PATH`).

If your document is confidential, check that your organisation has approved the AI provider and model you use for that kind of content.

### Where Files Are Stored

Each review is a separate run with its own run id (for example `20261023-142530-checkout-redesign-a1b2c3`). A run writes:

| File                                                   | Contents                                                  |
| ------------------------------------------------------ | --------------------------------------------------------- |
| `.mergementor/reports/prd-<run-id>-review-report.md`   | The report (shown on the dashboard's **Reports** page)    |
| `.mergementor/reports/prd-<run-id>-review-report.json` | The same report as structured data                        |
| `.mergementor/prd/<run-id>/source.docx`                | A copy of the document that was reviewed                  |
| `.mergementor/prd/<run-id>/document.json`              | The text extracted from the document, split into sections |
| `.mergementor/prd/<run-id>/images/`                    | Images sent for review (only with `--include-images`)     |
| `.mergementor/prd/<run-id>/transcripts/`               | A transcript of each AI request, for troubleshooting      |

The command prints the exact paths when it finishes. If a review fails, its run folder (the copy of the document, the extracted text, images and transcripts) is removed automatically.

The transcripts include the document text that was sent to the AI provider. For `prd` runs they are kept in the run's own folder, not in the `.mergementor/transcripts/` folder other commands use, so they are deleted with the run.

### Deleting a Run

To delete a run, either:

- Open the dashboard (`merge-mentor ui`), go to the **Reports** page and use **Delete** on the run. This removes the report, the copy of the document, the extracted text and images, and the AI transcripts together.
- Or delete the files yourself: the two report files and the run folder listed above, for example:

  ```bash
  rm .mergementor/reports/prd-<run-id>-review-report.md \
     .mergementor/reports/prd-<run-id>-review-report.json
  rm -r .mergementor/prd/<run-id>
  ```

Each review is independent, so deleting one run never affects another.
