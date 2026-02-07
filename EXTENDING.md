# Extending merge-mentor with New Specialist Reviews

This guide explains how to add new specialist review types to merge-mentor. Specialist reviews focus AI analysis on specific concerns (like testing, security, or performance) rather than general code quality.

## Table of Contents

- [Overview](#overview)
- [When to Add a Specialist Review](#when-to-add-a-specialist-review)
- [Architecture Pattern](#architecture-pattern)
- [Step-by-Step Implementation Guide](#step-by-step-implementation-guide)
- [Examples](#examples)
- [Testing Your Specialist](#testing-your-specialist)
- [Best Practices](#best-practices)

## Overview

Specialist reviews are focused AI-powered code reviews that analyze specific aspects of code:

- **`testing`** - Test coverage, quality, and best practices
- **`security`** - Vulnerabilities, authentication, data exposure
- **`performance`** - Efficiency, resource usage, optimization
- **`general`** - Comprehensive review (default, not a specialist)

Each specialist has:

1. Custom prompts that define the AI's role and scope
2. Specialized context gathering (optional)
3. Category definitions for findings
4. Integration with the review engine

## When to Add a Specialist Review

Add a specialist review type when:

✅ **The concern is distinct and focused** - Clear scope with specific expertise (e.g., accessibility, internationalization)

✅ **It requires different context** - Needs different file relationships or metadata than general reviews

✅ **The AI needs role-specific instructions** - Requires acting as a specific type of expert (security researcher, accessibility auditor)

✅ **It benefits from dedicated categories** - Findings need unique categorization (e.g., `wcag-violation`, `translation-missing`)

❌ **Don't add a specialist for:**

- Concerns already covered by general reviews (e.g., "naming conventions")
- One-off project-specific checks (use repository context instead)
- Concerns better handled by static analysis tools (linters, type checkers)

## Architecture Pattern

### Core Components

```
src/
├── ai/prompts/
│   ├── specialists/
│   │   ├── types.ts               # Shared types for specialists
│   │   ├── testing.ts             # Testing specialist prompts
│   │   └── <new-specialist>.ts    # Your new specialist
│   └── specialized.ts             # Security/Performance prompts
├── config.ts                      # ReviewType union
├── constants.ts                   # Category emojis
└── review/
    └── engine.ts                  # Integration logic
```

### Data Flow

```
CLI Input (--review-type X)
    ↓
config.ts validates ReviewType
    ↓
ReviewEngine loads specialist
    ↓
Specialist builds custom prompts
    ↓
AI analyzes with focused instructions
    ↓
Findings use specialist categories
```

## Step-by-Step Implementation Guide

### Step 1: Define the ReviewType

Add your new type to the `ReviewType` union in `src/config.ts`:

```typescript
/** Supported review types for specialized analysis. */
export type ReviewType =
  | "general"
  | "testing"
  | "security"
  | "performance"
  | "accessibility";
//                                                                              ^^^^^^^^^^^^^^
//                                                                              Add your type
```

Update the validation function:

```typescript
function validateReviewType(value: string | undefined): ReviewType {
  if (!value) return "general";

  const validTypes: ReviewType[] = [
    "general",
    "testing",
    "security",
    "performance",
    "accessibility",
  ];
  if (!validTypes.includes(value as ReviewType)) {
    throw new ConfigurationError(
      "reviewType",
      `Invalid review type: ${value}. Must be one of: ${validTypes.join(", ")}`,
    );
  }

  return value as ReviewType;
}
```

### Step 2: Add Category Emojis (Optional)

If your specialist introduces new finding categories, add them to `src/constants.ts`:

```typescript
/** Emoji mapping for finding categories. */
export const CATEGORY_EMOJI = {
  // ... existing categories ...

  // Accessibility specialist categories
  "wcag-violation": "♿",
  "aria-issue": "🏷️",
  "keyboard-nav": "⌨️",
  "color-contrast": "🎨",
} as const;
```

### Step 3: Create Specialist Types (Optional)

If your specialist needs custom context, define types in `src/ai/prompts/specialists/types.ts`:

```typescript
/**
 * Context for accessibility specialist reviews.
 */
export interface AccessibilityReviewContext {
  /** The file being reviewed */
  readonly filename: string;
  /** Framework detected (react, vue, angular, etc.) */
  readonly framework: "react" | "vue" | "angular" | "html" | "unknown";
  /** All UI component files in the PR */
  readonly uiFiles: readonly string[];
  /** Whether the file contains interactive elements */
  readonly hasInteractiveElements: boolean;
}

/**
 * Context for cross-file accessibility analysis.
 */
export interface AccessibilityCrossFileContext {
  /** Results from individual file reviews */
  readonly fileReviewResults: readonly FileReviewResult[];
  /** All changed UI files */
  readonly uiFiles: readonly string[];
  /** Summary of files changed in the PR */
  readonly filesSummary: string;
}
```

### Step 4: Create Prompt Builders

Create `src/ai/prompts/specialists/<your-specialist>.ts`:

```typescript
import type { PRDetails } from "../../../platforms/types.js";
import type { DiffManifest } from "../../../review/diffStorage.js";
import { buildSeverityContextSection } from "../severityContext.js";
import type {
  AccessibilityReviewContext,
  AccessibilityCrossFileContext,
} from "./types.js";

/**
 * Builds a workspace access section for prompts.
 */
function buildWorkspaceSection(repoPath?: string): string {
  if (!repoPath) return "";

  return `
---
# WORKSPACE ACCESS ENABLED

You have full access to the repository (not just changed files).
Your working directory is set to the repository root.

**Use these features extensively:**

- \`@workspace /search <query>\` - Find patterns across all files
- \`@file:relative/path/to/file.ts\` - Read any file in the repository
- \`@workspace /find <filename>\` - Locate files by name

**MANDATORY:** Always cross-reference the repository before reporting:
- Check for existing accessibility patterns
- Verify ARIA usage conventions in the codebase
- Understand the component library before reporting issues

---
`;
}

/**
 * Builds a repository context section for prompts.
 */
function buildRepoContextSection(repoContext?: string): string {
  if (!repoContext) return "";

  return `
---
# REPOSITORY-SPECIFIC GUIDELINES

The following standards are specific to this project.
**These take precedence over generic best practices.**

${repoContext}

---
`;
}

/**
 * Gets framework-specific accessibility guidance.
 */
function getFrameworkGuidance(framework: string): string {
  if (framework === "react") {
    return `
# REACT ACCESSIBILITY STANDARDS

## Required Patterns
- **Semantic HTML**: Use semantic elements over divs with roles
- **ARIA Labels**: aria-label, aria-labelledby, aria-describedby
- **Keyboard Navigation**: onKeyPress, onKeyDown with Enter/Space
- **Focus Management**: useRef, focus(), tabIndex

## Common Issues
- Missing alt text on images
- Buttons without accessible names
- Forms without labels
- Missing keyboard event handlers
- Non-semantic click handlers on divs
`;
  }

  // Add other frameworks as needed

  return "";
}

/**
 * Builds a file review prompt for accessibility analysis.
 *
 * @param manifest - Manifest describing stored diff files
 * @param context - Accessibility-specific context
 * @param repoContext - Optional repository-specific guidelines
 * @param repoPath - Optional path to cloned repository for workspace access
 * @returns Formatted prompt for accessibility review
 */
export function buildAccessibilityFileReviewPrompt(
  manifest: DiffManifest,
  context: AccessibilityReviewContext,
  repoContext?: string,
  repoPath?: string,
): string {
  const diffPrefix = repoPath ? ".merge-mentor/diffs/" : "";
  const filesListing = manifest.files
    .map(
      (f) =>
        `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) → @${diffPrefix}${f.diffPath}`,
    )
    .join("\n");

  const repoContextSection = buildRepoContextSection(repoContext);
  const workspaceSection = buildWorkspaceSection(repoPath);
  const frameworkGuidance = getFrameworkGuidance(context.framework);
  const severityContext = buildSeverityContextSection();

  return `# YOUR ROLE
You are an **Accessibility Specialist** performing an accessibility-focused code review.
Your job is to ensure the code is accessible to users with disabilities.

**Framework Detected**: ${context.framework}
**UI Files in PR**: ${context.uiFiles.length}
**Has Interactive Elements**: ${context.hasInteractiveElements ? "Yes" : "No"}
${repoContextSection}${workspaceSection}
# CRITICAL SCOPE RESTRICTIONS

**ONLY REPORT** accessibility issues. You MUST IGNORE:
- ❌ Logic bugs (unless they affect accessibility)
- ❌ Performance issues
- ❌ Code style/quality
- ❌ Security vulnerabilities
- ❌ Missing tests

If an issue does NOT affect users with disabilities, DO NOT REPORT IT.

# ACCESSIBILITY FOCUS AREAS

## WCAG 2.1 Compliance
- **Perceivable**: Alt text, captions, color contrast, text sizing
- **Operable**: Keyboard navigation, focus indicators, timing
- **Understandable**: Labels, error messages, language
- **Robust**: Valid HTML, ARIA usage, compatibility

## Specific Checks
1. **Semantic HTML**: Buttons, headings, landmarks, lists
2. **ARIA**: Proper roles, states, properties
3. **Keyboard Navigation**: Tab order, keyboard handlers
4. **Focus Management**: Visible focus, logical order
5. **Forms**: Labels, error messages, validation feedback
6. **Images**: Alt text for meaningful images, decorative handling
7. **Color**: Not sole indicator, sufficient contrast
8. **Interactive Elements**: Accessible names, roles, states
${frameworkGuidance}${severityContext}
# FILES TO REVIEW

${filesListing}

# OUTPUT FORMAT

You MUST respond with a valid JSON object (no markdown, no code fences):

{
  "findings": [
    {
      "line": 42,
      "category": "wcag-violation",
      "severity": "high",
      "confidence": "high",
      "message": "Image missing alt text",
      "suggestion": "Add alt attribute: <img src='...' alt='Description of image' />",
      "codeSnippet": "<img src='logo.png' />"
    }
  ],
  "resolved_comments": []
}

**Categories**: Use these values only:
- \`wcag-violation\` - WCAG guideline violations
- \`aria-issue\` - Incorrect or missing ARIA attributes
- \`keyboard-nav\` - Keyboard navigation problems
- \`color-contrast\` - Insufficient color contrast

**Severity levels**: critical, high, medium, low
**Confidence levels**: high, medium, low

Focus on actionable findings with clear solutions. Skip minor issues.`;
}

/**
 * Builds a cross-file analysis prompt for accessibility concerns.
 *
 * @param prDetails - Pull request metadata
 * @param context - Cross-file accessibility context
 * @param repoContext - Optional repository-specific guidelines
 * @param repoPath - Optional path to cloned repository for workspace access
 * @returns Formatted prompt for cross-file accessibility analysis
 */
export function buildAccessibilityCrossFilePrompt(
  prDetails: PRDetails,
  context: AccessibilityCrossFileContext,
  repoContext?: string,
  repoPath?: string,
): string {
  const repoContextSection = buildRepoContextSection(repoContext);
  const workspaceSection = buildWorkspaceSection(repoPath);
  const severityContext = buildSeverityContextSection();

  // Get unique categories from file reviews
  const categoriesFound = new Set(
    context.fileReviewResults.flatMap((r) => r.findings.map((f) => f.category)),
  );

  return `# YOUR ROLE
You are an **Accessibility Specialist** performing cross-file accessibility analysis.
Look for accessibility patterns and issues that span multiple files.
${repoContextSection}${workspaceSection}
# PR CONTEXT

**Title**: ${prDetails.title}
**Description**: ${prDetails.body || "No description provided"}

**Files Summary**: ${context.filesSummary}

**UI Files Changed**: ${context.uiFiles.length}

**Categories Found in File Reviews**: ${Array.from(categoriesFound).join(", ") || "None"}

# CROSS-FILE ANALYSIS FOCUS

Look for these patterns:

1. **Inconsistent ARIA Usage**: Different ARIA patterns for similar components
2. **Missing Landmark Structure**: Lack of navigation, main, complementary landmarks
3. **Form Accessibility**: Related form fields without proper grouping/fieldsets
4. **Focus Order**: Tab order issues across multiple components
5. **Heading Hierarchy**: Skipped heading levels, non-logical structure
6. **Component Patterns**: Similar components with different accessibility approaches

# IMPORTANT GUIDELINES

- Focus on **architectural** and **pattern-based** issues
- Skip issues already reported in individual file reviews
- Only report findings that require understanding multiple files
- Provide actionable recommendations for systemic improvements
${severityContext}
# OUTPUT FORMAT

Respond with valid JSON:

{
  "findings": [
    {
      "category": "wcag-violation",
      "severity": "high",
      "confidence": "high",
      "message": "Inconsistent heading hierarchy across navigation components",
      "suggestion": "Establish consistent heading structure: Nav (h1) → Sections (h2) → Items (h3)"
    }
  ]
}

**Categories**: wcag-violation, aria-issue, keyboard-nav, color-contrast
**Severity/Confidence**: critical, high, medium, low`;
}
```

### Step 5: Integrate with Review Engine

Update `src/review/engine.ts` to handle your specialist type.

**For file reviews**, add a case to the `reviewType` conditional (~line 300):

```typescript
// In the reviewFileBatch method
if (reviewType === "testing") {
  // ... existing testing logic ...
} else if (reviewType === "accessibility") {
  // Build accessibility context
  const allChangedFiles = filesWithPatches.map((f) => f.filename);
  const uiFiles = allChangedFiles.filter((f) => isUIComponentFile(f));

  const context: AccessibilityReviewContext = {
    filename: manifest.files.map((f) => f.filename).join(", "),
    framework: detectFramework(allChangedFiles[0]),
    uiFiles,
    hasInteractiveElements: true, // TODO: detect from diff
  };

  prompt = buildAccessibilityFileReviewPrompt(
    manifest,
    context,
    repoContext,
    repoPath,
  );
  this.logger.info(
    { framework: context.framework, uiFilesFound: uiFiles.length },
    "Built accessibility specialist prompt",
  );
} else {
  // General review
  prompt = buildBatchedFileReviewPrompt(
    manifest,
    existingCommentsContext,
    repoContext,
    repoPath,
  );
}
```

**For cross-file reviews**, add a case in the `performCrossFileAnalysis` method (~line 500):

```typescript
// In the performCrossFileAnalysis method
if (reviewType === "testing") {
  // ... existing testing logic ...
} else if (reviewType === "accessibility") {
  const allChangedFiles = files.map((f) => f.filename);
  const uiFiles = allChangedFiles.filter((f) => isUIComponentFile(f));

  const context: AccessibilityCrossFileContext = {
    fileReviewResults: fileResults,
    uiFiles,
    filesSummary,
  };

  prompt = buildAccessibilityCrossFilePrompt(
    prDetails,
    context,
    repoContext,
    repoPath,
  );
} else {
  // General cross-file review
  prompt = buildCrossFilePrompt(
    prDetails,
    fileResults,
    filesSummary,
    repoContext,
    repoPath,
  );
}
```

**Add necessary imports** at the top of `engine.ts`:

```typescript
import {
  buildAccessibilityFileReviewPrompt,
  buildAccessibilityCrossFilePrompt,
} from "../ai/prompts/specialists/accessibility.js";
import type {
  AccessibilityReviewContext,
  AccessibilityCrossFileContext,
} from "../ai/prompts/specialists/types.js";
```

### Step 6: Update Documentation

Add your specialist to the README.md:

**In the "Specialist Review Types" section:**

````markdown
### Specialist Review Types

Focus reviews on specific concerns with the `--review-type` flag:

```bash
# Accessibility-focused review - WCAG compliance
merge-mentor review --pr 123 --review-type accessibility --write
```
````

**Available Review Types:**

- **`accessibility`**: Web accessibility specialist focused on WCAG 2.1 compliance, ARIA usage, keyboard navigation

````

**In the "When to Use Specialist Reviews" table:**

```markdown
| Review Type | Use When | What It Checks |
|-------------|----------|----------------|
| **accessibility** | Building user interfaces or forms | WCAG compliance, ARIA attributes, keyboard navigation, focus management, alt text |
````

## Examples

### Example 1: Simple Specialist (No Custom Context)

For a specialist that doesn't need custom context (like the existing `security` and `performance` specialists), you can keep it simple:

**In `src/ai/prompts/specialized.ts`:**

```typescript
export function buildDocumentationReviewPrompt(
  manifest: DiffManifest,
  repoContext?: string,
  repoPath?: string,
): string {
  const diffPrefix = repoPath ? ".merge-mentor/diffs/" : "";
  const filesListing = manifest.files
    .map((f) => `- ${f.filename} (${f.status}) → @${diffPrefix}${f.diffPath}`)
    .join("\n");

  return `# YOUR ROLE
You are a **Documentation Specialist** reviewing code documentation.

# SCOPE
**ONLY REPORT** documentation issues:
- Missing or incomplete TSDoc/JSDoc comments
- Outdated comments
- Missing README updates
- Incorrect API documentation

# FILES
${filesListing}

# OUTPUT
Respond with valid JSON with findings array...`;
}
```

**In `engine.ts`:**

```typescript
import {
  buildSecurityReviewPrompt,
  buildPerformanceReviewPrompt,
  buildDocumentationReviewPrompt
} from "../ai/prompts/specialized.js";

// In reviewFileBatch:
} else if (reviewType === "documentation") {
  prompt = buildDocumentationReviewPrompt(manifest, repoContext, repoPath);
} else {
  prompt = buildBatchedFileReviewPrompt(manifest, existingCommentsContext, repoContext, repoPath);
}
```

### Example 2: Language-Specific Specialist

For specialists that provide language-specific guidance:

```typescript
function getLanguageInternationalizationGuidance(language: string): string {
  switch (language) {
    case "typescript":
      return `
# TYPESCRIPT I18N PATTERNS

- Use i18next or react-intl for translations
- Extract all user-facing strings
- Use translation keys, not hardcoded text
- Support pluralization and interpolation
`;
    case "python":
      return `
# PYTHON I18N PATTERNS

- Use gettext for translations
- Mark translatable strings with _()
- Support locale-aware formatting
`;
    default:
      return "";
  }
}
```

## Testing Your Specialist

### Unit Tests

Create `src/ai/prompts/specialists/<your-specialist>.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  buildAccessibilityFileReviewPrompt,
  buildAccessibilityCrossFilePrompt,
} from "./accessibility.js";
import type { AccessibilityReviewContext } from "./types.js";
import type { DiffManifest } from "../../../review/diffStorage.js";

describe("Accessibility Specialist Prompts", () => {
  describe("buildAccessibilityFileReviewPrompt", () => {
    it("includes framework-specific guidance", () => {
      const manifest: DiffManifest = {
        files: [
          {
            filename: "Button.tsx",
            diffPath: "Button.diff",
            status: "modified",
            additions: 10,
            deletions: 5,
          },
        ],
      };

      const context: AccessibilityReviewContext = {
        filename: "Button.tsx",
        framework: "react",
        uiFiles: ["Button.tsx"],
        hasInteractiveElements: true,
      };

      const prompt = buildAccessibilityFileReviewPrompt(manifest, context);

      expect(prompt).toContain("REACT ACCESSIBILITY STANDARDS");
      expect(prompt).toContain("wcag-violation");
      expect(prompt).toContain("aria-issue");
    });

    it("restricts scope to accessibility issues only", () => {
      const manifest: DiffManifest = { files: [] };
      const context: AccessibilityReviewContext = {
        filename: "test.tsx",
        framework: "unknown",
        uiFiles: [],
        hasInteractiveElements: false,
      };

      const prompt = buildAccessibilityFileReviewPrompt(manifest, context);

      expect(prompt).toContain("ONLY REPORT accessibility issues");
      expect(prompt).toContain("MUST IGNORE");
    });
  });
});
```

### Integration Tests

Test end-to-end with `tests/integration/<your-specialist>.integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ReviewEngine } from "../../src/review/engine.js";
// ... setup mocks ...

describe("Accessibility Specialist Integration", () => {
  it("uses accessibility prompts when reviewType is accessibility", async () => {
    const engine = new ReviewEngine(mockPlatform, "test-bot", {
      reviewType: "accessibility",
      dryRun: true,
    });

    await engine.reviewPR(123);

    // Verify accessibility-specific prompt was used
    expect(mockAIProvider.executePrompt).toHaveBeenCalledWith(
      expect.stringContaining("Accessibility Specialist"),
    );
  });
});
```

### Manual Testing

```bash
# Test dry-run
merge-mentor review --pr 123 --review-type accessibility

# Test with write
merge-mentor review --pr 123 --review-type accessibility --write

# Test with multiple runs
merge-mentor review --pr 123 --review-type accessibility --runs 3 --write
```

## Best Practices

### Prompt Design

1. **Clear Role Definition** - Start with "You are a [Specialist] performing [specific task]"
2. **Explicit Scope Restrictions** - Use "ONLY REPORT X, MUST IGNORE Y" sections
3. **Actionable Categories** - Use specific, meaningful category names
4. **Severity Guidance** - Provide clear criteria for severity levels
5. **Workspace Instructions** - Guide AI to use repository context effectively

### Context Gathering

1. **Minimal but Sufficient** - Only gather context needed for specialist analysis
2. **Efficient Detection** - Use simple heuristics for file classification
3. **Language-Aware** - Provide language/framework-specific guidance
4. **Fail Gracefully** - Default to "unknown" when detection fails

### Integration

1. **Consistent Patterns** - Follow existing specialist patterns (testing, security, performance)
2. **Error Handling** - Handle missing context gracefully
3. **Logging** - Log specialist-specific context for debugging
4. **Performance** - Avoid expensive context gathering operations

### Documentation

1. **Clear Use Cases** - Explain when to use the specialist
2. **Example Commands** - Provide copy-paste examples
3. **Category Reference** - Document all categories with emoji mappings
4. **Known Limitations** - Be upfront about what the specialist doesn't cover

## Common Pitfalls

❌ **Overly Broad Scope** - "Code quality specialist" is too vague, already covered by general reviews

❌ **Duplicate General Review** - Don't recreate what general reviews already do

❌ **Complex Context Gathering** - Avoid expensive operations that slow down reviews

❌ **Poor Category Names** - Use specific categories like `wcag-violation` not generic `issue`

❌ **Missing Integration Tests** - Always test the full review flow

❌ **Inconsistent Patterns** - Follow existing specialist structure, don't invent new patterns

## Getting Help

- Review existing specialists: `src/ai/prompts/specialists/testing.ts` (most complete example)
- Check simple specialists: `src/ai/prompts/specialized.ts` (security, performance)
- See integration: `src/review/engine.ts` (search for `reviewType`)
- Ask questions: Open an issue with the `enhancement` label

## Checklist

Use this checklist when adding a new specialist:

- [ ] Added type to `ReviewType` union in `src/config.ts`
- [ ] Updated `validateReviewType()` function in `src/config.ts`
- [ ] Added category emojis to `src/constants.ts` (if needed)
- [ ] Created context types in `src/ai/prompts/specialists/types.ts` (if needed)
- [ ] Created prompt builders in `src/ai/prompts/specialists/<name>.ts`
- [ ] Integrated file review in `src/review/engine.ts` (reviewFileBatch method)
- [ ] Integrated cross-file review in `src/review/engine.ts` (performCrossFileAnalysis method)
- [ ] Added imports for prompts and types to `src/review/engine.ts`
- [ ] Created unit tests in `src/ai/prompts/specialists/<name>.spec.ts`
- [ ] Created integration tests in `tests/integration/<name>.integration.test.ts`
- [ ] Updated README.md with specialist description and examples
- [ ] Updated README.md "When to Use" table
- [ ] Manually tested with `--review-type <name>` flag
- [ ] Verified categories appear correctly in output
- [ ] Tested with `--runs` flag for multiple passes
- [ ] Updated CHANGELOG.md with new specialist feature
