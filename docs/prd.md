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

# After editing the document, review it again and see what changed
merge-mentor prd checkout-redesign.docx --against latest
```

When the review finishes, the command prints the readiness verdict, the number of issues at each severity, and where the report was saved. Open the Markdown report in any editor, or launch the dashboard with `merge-mentor ui` and open it from the **Reports** page.

---

## Options

### General Options

| Option               | Description                                                                                                                        | Env Variable   | Default          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------- |
| `<file>`             | Path to the Word document (`.docx`) to review                                                                                      | -              | -                |
| `--type <type>`      | Document type, which picks the review checklist: `prd` or `frd`                                                                    | -              | `prd`            |
| `--against <run-id>` | Compare with an earlier review of this document: a run id, or `latest` (see [Re-reviewing](#re-reviewing-a-revised-document))      | -              | -                |
| `--annotate`         | Also save a copy of the document with each finding as a Word comment (see [Findings as Word comments](#findings-as-word-comments)) | -              | `false`          |
| `--include-images`   | Also review images in the document (see [Images](#images))                                                                         | -              | `false`          |
| `--temp-path <path>` | Base folder for reports and run data (see [Where files are stored](#where-files-are-stored))                                       | `MM_TEMP_PATH` | `./.mergementor` |

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

1. **Requirement quality**: is each requirement single, testable, unambiguous, free of vague words, clear about who acts, and uniquely identified?
2. **Acceptance criteria**: does each requirement have criteria that can be measured and verified, including failure and boundary cases?
3. **Edge cases and error handling**: what happens on invalid input, failures, empty states and repeated or concurrent actions?
4. **Business rules and logic**: are calculations, conditions, statuses and defaults complete and unambiguous?
5. **Data and interfaces**: are fields, formats, screens, reports and integrations described in enough detail to build?
6. **Roles and access**: which roles can do what, and who can see or change sensitive data?
7. **Quality attributes**: performance, security, availability, accessibility and audit needs.
8. **Traceability and dependencies**: can requirements be traced to goals, do references resolve, and are dependencies and assumptions written down?

For an FRD, the reviewer also goes through each requirement one by one, so a requirement with no acceptance criteria, identifier or error handling is reported against that requirement.

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

## Findings as Word Comments

With `--annotate`, the review also saves a copy of your document next to the original, named `<name>-reviewed.docx` (`-reviewed-2`, and so on, if that file already exists; nothing is ever overwritten). Open it in Word and each finding appears as a comment from **Merge Mentor** on the paragraph that contains the quoted text, with the severity, the problem, the suggestion and any question for you. Resolve the comments as you fix things.

- The original document is never changed.
- Comments are attached to the whole paragraph, not just the quoted words, and the comment text repeats what the report says.
- A finding whose quoted text cannot be found in a single paragraph (for example text inside a text box, or spanning paragraphs) has no comment. It is still in the report, and the command prints how many were left out.
- Existing comments in your document are kept.
- Combine it with `--against` to annotate only the issues that are still open or new.
- A copy is also kept with the run, in `.mergementor/prd/<run-id>/annotated.docx`, and removed with the run.

## Re-reviewing a Revised Document

After you fix the issues in your document, review it again with `--against`. Give the run id of the earlier review (printed when it finished, and part of the report's file name), or `latest` to use the newest earlier review of a file with the same name. Both reviews must use the same `--type`.

The new report opens with **Changes since the previous review**:

- the verdict before and after (for example _Not ready_ → _Needs work_);
- how many issues are **resolved**, **still open** and **new**, with the resolved ones listed;
- 🆕 on each new issue further down the report.

An issue counts as the same one when it quotes (nearly) the same text and describes the same kind of problem, so rewording around it does not make it look new. If either review was partial, the report says that the numbers may be overstated. Each review is still a separate run with its own report; the earlier one is not changed.

### In the dashboard

On the **PRD / FRD Review** page, after a review finishes, choose the updated `.docx` and leave **Compare with the previous review** ticked. The result shows the resolved, still open and new counts, and the full report starts with the same comparison. Tick **Add the findings to a Word copy as comments** to get a **Download Word copy with comments** button on the result. The copy is kept with the run and removed when you delete it.

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

## Work Breakdown

Once a document is ready, `prd-breakdown` turns it into a first draft of a backlog: **epics**, **features** and **product backlog items (PBIs)**, listed in the order they should be built.

```bash
# Break down a Word file directly
merge-mentor prd-breakdown checkout-redesign.docx

# Break down a document that `prd` already reviewed (no need to read the file again)
merge-mentor prd-breakdown --from-review 20261023-142530-checkout-redesign-a1b2c3

# Break down a document whose review found blockers
merge-mentor prd-breakdown --from-review 20261023-142530-checkout-redesign-a1b2c3 --force
```

Give it either a file or `--from-review <run-id>` (the run id is printed when a review finishes, and is part of the report's file name), not both. `--type prd|frd` sets the document type of a file; a reviewed document keeps the type of its review. The AI provider options are the same as for `prd`. A review that found blockers is refused unless you pass `--force`, because a breakdown built on a document with gaps would carry the gaps into the backlog.

### How the order is worked out

1. Each part of the document is read on its own and proposes epics, features and PBIs, using only what the document says.
2. A final step merges duplicates (the same epic is often described in several places), groups the items and puts epics, features and PBIs in a logical order: what others depend on first, then the value delivered, then risk. It also records which PBIs must wait for others.
3. Every PBI is checked against the document: its quote must be found in the text, and its dependencies must name real PBIs that come earlier in the order. Items the ordering step missed are kept under **Needs placement** rather than dropped.

### The Breakdown

The Markdown file contains:

- **Counts and a short summary** of the suggested delivery order, followed by a numbered outline.
- **Epics, features and PBIs**, numbered by position (`1`, `1.1`, `1.1.1`). Each PBI has a description, acceptance criteria as a checklist, the PBIs it depends on, and the text of the document it comes from. A PBI whose quote cannot be found in the document is marked.
- **Open questions** the document leaves unanswered.
- **Not covered**: sections that have text but produced no work items, parts that could not be read, and any dependencies that were left out because they were invalid.

If the ordering step cannot run, the items keep the order of the document and the breakdown says so. The breakdown is an automated first draft: check it, reorder it and refine it with your team before planning work from it.

### Web Dashboard

On the **PRD / FRD Review** page, a finished review offers **Break down into work items**. The result is a read-only tree of epics, features and PBIs (open an item to see its criteria, dependencies and source text). **Download Markdown** saves the file for further processing, **Copy Markdown** copies it, and the **Reports** page lists it with a download button too. If the review found blockers, the button asks you to fix them first, or to break down anyway.

The breakdown is saved as `.mergementor/reports/prd-<run-id>-breakdown.md` (and `.json`) next to the review report. It uses the same run folder, so **Delete run** removes the review, the breakdown and the stored document together.

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
| `.mergementor/reports/prd-<run-id>-breakdown.md`       | The [work breakdown](#work-breakdown), once one is made   |
| `.mergementor/reports/prd-<run-id>-breakdown.json`     | The same breakdown as structured data                     |
| `.mergementor/prd/<run-id>/source.docx`                | A copy of the document that was reviewed                  |
| `.mergementor/prd/<run-id>/document.json`              | The text extracted from the document, split into sections |
| `.mergementor/prd/<run-id>/images/`                    | Images sent for review (only with `--include-images`)     |
| `.mergementor/prd/<run-id>/transcripts/`               | A transcript of each AI request, for troubleshooting      |

The command prints the exact paths when it finishes. If a review fails, its run folder (the copy of the document, the extracted text, images and transcripts) is removed automatically.

The transcripts include the document text that was sent to the AI provider. For `prd` runs they are kept in the run's own folder, not in the `.mergementor/transcripts/` folder other commands use, so they are deleted with the run.

Reviews started from the dashboard also keep a live log of the run in `.mergementor/runs/<dashboard-run-id>/` (progress messages, the AI output as it streamed in and the final report), so the page can be reloaded while a review is running. It can contain text from the document. Deleting the run from the **Reports** page deletes this log too. The log of a dashboard review that failed (and so has no report to delete) is removed by the dashboard's normal clean-up after 7 days (see `MM_RUN_RETENTION_MS` in the [Configuration Guide](./configuration.md)), or you can delete its folder yourself.

AI providers can keep their own copy of a conversation. For `prd` runs Merge Mentor asks them not to: the `copilot-sdk` provider permanently deletes the Copilot session (which the Copilot runtime otherwise keeps on disk, outside `.mergementor`, so it can be resumed) after each request, and the `opencode-sdk` provider deletes its OpenCode session after each request. What the AI service itself retains is governed by your provider's terms. If a Copilot session cannot be deleted, the review still completes, but the terminal, the web page and the report's “About this review” section warn that parts of the document may remain in Copilot's own storage so you can remove them.

### Deleting a Run

To delete a run, either:

- Open the dashboard (`merge-mentor ui`), go to the **Reports** page and use **Delete run** on the report. This removes the report, the copy of the document, the extracted text and images, the AI transcripts and, for a review started from the dashboard, its live log together.
- Or delete the files yourself: the report files (the review and any work breakdown) and the run folder listed above, for example:

  ```bash
  rm -f .mergementor/reports/prd-<run-id>-review-report.md \
        .mergementor/reports/prd-<run-id>-review-report.json \
        .mergementor/reports/prd-<run-id>-breakdown.md \
        .mergementor/reports/prd-<run-id>-breakdown.json
  rm -r .mergementor/prd/<run-id>
  ```

Each review is independent, so deleting one run never affects another.
