# Feature Plan: PRD Review Document Handling Improvements

## Overview

`merge-mentor prd` accepts only unprotected `.docx` files (4.1.0). Legacy `.doc`
and password-protected documents are common in practice and currently fail.

## Current State

- `docs/prd.md`: ".doc files and password-protected documents are not
  supported: save them as an unprotected .docx first."
- Files up to 20 MB accepted; parser in `libs/core/src/review/prd/docxParser.ts`.

## Proposal

1. **Better errors first (small):** detect legacy `.doc` (OLE header) and
   encrypted packages and return a specific message with the exact "Save As"
   steps, in both CLI and dashboard.
2. **Optional later:** `.doc` conversion via an installed LibreOffice, behind an
   explicit flag; never bundled or run silently.
3. Keep everything local; do not upload documents anywhere.

## Tests

- Fixtures for legacy `.doc`, encrypted `.docx`, renamed non-Office file,
  truncated zip.

## Open Decisions

- Is optional LibreOffice conversion worth the support burden?
