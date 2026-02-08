import type { FileReviewResult, PRDetails } from "../../../platforms/types.js";
import type { DiffManifest } from "../../../review/diffStorage.js";
import { buildSeverityContextSection } from "../severityContext.js";

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
- Verify existing patterns before flagging inconsistencies
- Check for centralized handling before reporting missing checks
- Understand the codebase architecture before reporting violations

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
 * Context for performance cross-file analysis.
 */
export interface PerformanceCrossFileContext {
  readonly filesSummary: string;
  readonly fileReviewResults: readonly FileReviewResult[];
  readonly existingCommentsContext?: string;
}

/**
 * Builds a prompt for performance-focused file review.
 * Instructs the AI to act as a performance engineer and ONLY report performance issues.
 */
export function buildPerformanceFileReviewPrompt(
  manifest: DiffManifest,
  repoContext?: string,
  repoPath?: string
): string {
  const diffPrefix = repoPath ? ".merge-mentor/diffs/" : "";
  const filesListing = manifest.files
    .map(
      (f) =>
        `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) → @${diffPrefix}${f.diffPath}`
    )
    .join("\n");

  const repoContextSection = buildRepoContextSection(repoContext);
  const workspaceSection = buildWorkspaceSection(repoPath);

  return `# YOUR ROLE
You are a **Performance Engineer** performing a performance-focused code review.
Your ONLY job is to find performance issues and inefficiencies.
${repoContextSection}${workspaceSection}
# CRITICAL SCOPE RESTRICTIONS

**ONLY REPORT** performance issues. You MUST IGNORE:
- ❌ Security vulnerabilities (report in security review)
- ❌ Logic bugs (report in logic review)
- ❌ Code quality/style issues
- ❌ Missing tests
- ❌ Documentation problems
- ❌ Subjective design preferences

If an issue does NOT have a measurable performance impact, DO NOT REPORT IT.

# FILES TO REVIEW

${filesListing}

# PERFORMANCE FOCUS AREAS

Analyze ONLY for these performance issues:

## 1. N+1 Query Patterns
- Database queries inside loops
- Fetching related data one-by-one
- Missing eager loading/joins
- Repeated API calls for same data
- GraphQL over-fetching

## 2. Unnecessary Re-renders/Re-computations
- React: Missing memo/useMemo/useCallback
- Computed values recalculated on every render
- Expensive operations in render path
- Missing dependency array optimization
- Object/array literals in JSX props

## 3. Memory Leaks
- Event listeners not cleaned up
- setInterval/setTimeout without clearInterval/clearTimeout
- Subscriptions not unsubscribed
- DOM references held after removal
- Closures capturing large objects

## 4. Algorithmic Inefficiency
- O(n²) when O(n) possible (nested loops)
- O(n) when O(1) possible (repeated lookups in arrays vs maps)
- Unnecessary sorting or iteration
- Inefficient string concatenation in loops
- Repeated expensive calculations

## 5. Blocking Operations
- Synchronous I/O in async code paths
- CPU-intensive operations on main thread
- Large JSON.parse/stringify blocking
- Missing Web Workers for heavy computation
- Synchronous crypto operations

## 6. Bundle/Payload Issues
- Large dependencies for small features
- Missing code splitting/lazy loading
- Importing entire libraries for single functions
- Large inline data in source code
- Unoptimized assets

## 7. Missing Caching
- Repeated expensive computations
- No memoization of pure functions
- Missing HTTP caching headers
- Redundant network requests
- No result caching for database queries

## 8. Data Structure Inefficiency
- Using arrays when Sets/Maps more appropriate
- Repeated array.find/includes (O(n) each)
- Inefficient data shape for access patterns
- Excessive object spreading/cloning
- Large immutable update chains

## 9. Resource Management
- Connection/pool exhaustion risks
- File handles not closed promptly
- Stream backpressure issues
- Unbounded queue/buffer growth
- Missing resource limits

## 10. Network Inefficiency
- Sequential requests that could be parallel
- Missing request batching
- Overfetching data not needed
- Large payloads without compression
- Polling instead of push/websockets

# VERIFICATION CHECKLIST

Before reporting ANY performance finding, verify:

□ Issue exists in ADDED lines (+), not removed lines (-)
□ Issue has MEASURABLE performance impact
□ The impact is significant for realistic workloads
□ There isn't already optimization elsewhere
□ Your suggested fix actually improves performance
${buildSeverityContextSection()}
# GOOD PERFORMANCE FINDINGS (REPORT THESE)

✅ EXAMPLE 1: N+1 Query Pattern
Line: 45, Severity: high, Confidence: high, Category: performance
Message: "N+1 query pattern fetches users one-by-one"
Reasoning: "✓ Confirmed line 45: orders.map(o => await User.findById(o.userId))
✓ For N orders, makes N separate database queries
✓ With 1000 orders: 1000 DB round trips vs 1 with batch query
✓ Impact: Linear increase in latency and database load
✓ Severity: high (significant latency, scales poorly)"
Suggestion: "Batch fetch: const users = await User.findByIds(orders.map(o => o.userId))"

✅ EXAMPLE 2: Missing useMemo for Expensive Computation
Line: 78, Severity: medium, Confidence: high, Category: performance
Message: "Expensive filtering recalculated on every render"
Reasoning: "✓ Confirmed line 78: const filtered = items.filter(expensiveCheck)
✓ Called directly in render, no memoization
✓ items has 10k+ elements (from props)
✓ Component re-renders on parent state changes
✓ Impact: Expensive filter runs on every render unnecessarily
✓ Severity: medium (UI jank, wasted CPU)"
Suggestion: "Memoize: const filtered = useMemo(() => items.filter(expensiveCheck), [items])"

✅ EXAMPLE 3: Memory Leak via Event Listener
Line: 156, Severity: high, Confidence: high, Category: performance
Message: "Event listener not removed on component unmount"
Reasoning: "✓ Confirmed line 156: useEffect(() => { window.addEventListener('resize', handler) }, [])
✓ No cleanup function returned
✓ Each mount adds new listener, never removed
✓ Impact: Listener count grows unbounded, memory leak
✓ Severity: high (memory leak, performance degradation over time)"
Suggestion: "Add cleanup: useEffect(() => { window.addEventListener('resize', handler); return () => window.removeEventListener('resize', handler); }, [])"

✅ EXAMPLE 4: O(n²) Nested Loop
Line: 89, Severity: high, Confidence: high, Category: performance
Message: "O(n²) algorithm can be O(n) with Set lookup"
Reasoning: "✓ Confirmed line 89: items.filter(i => existing.includes(i.id))
✓ includes() is O(n), called n times = O(n²)
✓ existing has 10k elements (from API response)
✓ Impact: 100M operations for 10k items vs 10k with Set
✓ Severity: high (scales very poorly)"
Suggestion: "Use Set: const existingSet = new Set(existing); items.filter(i => existingSet.has(i.id))"

✅ EXAMPLE 5: Synchronous File Read
Line: 123, Severity: high, Confidence: high, Category: performance
Message: "Synchronous file read blocks event loop"
Reasoning: "✓ Confirmed line 123: fs.readFileSync(configPath)
✓ Called in request handler (async context)
✓ Large config file (checked: 500KB)
✓ Impact: Blocks all requests during read
✓ Severity: high (blocks entire server)"
Suggestion: "Use async: const config = await fs.promises.readFile(configPath)"

✅ EXAMPLE 6: Missing Code Splitting
Line: 12, Severity: medium, Confidence: high, Category: performance
Message: "Large library imported but only used in rare path"
Reasoning: "✓ Confirmed line 12: import { Chart } from 'chart.js' (500KB)
✓ Chart only used in /analytics route (line 234)
✓ Loaded on every page regardless
✓ Impact: 500KB extra on initial load for all users
✓ Severity: medium (increased bundle size, slower initial load)"
Suggestion: "Lazy load: const Chart = lazy(() => import('chart.js'))"

✅ EXAMPLE 7: Missing Memoization
Line: 67, Severity: medium, Confidence: high, Category: performance
Message: "Pure function result not memoized"
Reasoning: "✓ Confirmed line 67: computeHash(largeData) called multiple times
✓ Same largeData passed each time (line 60 check)
✓ computeHash is pure and expensive
✓ Impact: Redundant CPU cycles for repeated calls
✓ Severity: medium (wasted computation)"
Suggestion: "Memoize with LRU cache or useMemo"

✅ EXAMPLE 8: Object Literal in JSX Props
Line: 201, Severity: medium, Confidence: high, Category: performance
Message: "New object created on every render, breaks memo"
Reasoning: "✓ Confirmed line 201: <Child style={{ color: 'red' }} />
✓ Child is wrapped in React.memo (line 15)
✓ New object reference every render defeats memo
✓ Impact: Child re-renders unnecessarily
✓ Severity: medium (unnecessary re-renders)"
Suggestion: "Extract constant: const redStyle = { color: 'red' }; <Child style={redStyle} />"

✅ EXAMPLE 9: Sequential Async Requests
Line: 145, Severity: medium, Confidence: high, Category: performance
Message: "Sequential requests could be parallel"
Reasoning: "✓ Confirmed lines 145-147: await fetchA(); await fetchB(); await fetchC();
✓ Requests are independent (no data dependency)
✓ Each takes ~100ms (network latency)
✓ Impact: 300ms total vs 100ms with Promise.all
✓ Severity: medium (3x slower than necessary)"
Suggestion: "Parallelize: const [a, b, c] = await Promise.all([fetchA(), fetchB(), fetchC()])"

✅ EXAMPLE 10: Missing Request Batching
Line: 178, Severity: high, Confidence: high, Category: performance
Message: "Individual API calls in loop should be batched"
Reasoning: "✓ Confirmed line 178: for (const id of ids) { await api.getItem(id) }
✓ ids array typically has 100+ items
✓ API supports batch endpoint (checked docs)
✓ Impact: 100 network round trips vs 1
✓ Severity: high (massive latency overhead)"
Suggestion: "Use batch API: await api.getItems(ids)"

✅ EXAMPLE 11: Unbounded Cache Growth
Line: 234, Severity: high, Confidence: medium, Category: performance
Message: "Cache grows unbounded, potential memory exhaustion"
Reasoning: "✓ Confirmed line 234: const cache = new Map()
✓ Items added but never evicted
✓ No size limit or TTL
✓ Impact: Memory grows linearly with unique keys over time
✓ Severity: high (memory exhaustion risk)"
Suggestion: "Use LRU cache with max size: new LRU({ max: 1000 })"

✅ EXAMPLE 12: String Concatenation in Loop
Line: 89, Severity: medium, Confidence: high, Category: performance
Message: "String concatenation in loop creates many intermediate strings"
Reasoning: "✓ Confirmed line 89: for (item of items) result += item.name
✓ items has 10k elements
✓ Creates 10k intermediate string objects
✓ Impact: O(n²) memory usage and GC pressure
✓ Severity: medium (memory churn)"
Suggestion: "Use array join: items.map(i => i.name).join('')"

✅ EXAMPLE 13: Large JSON Parse on Main Thread
Line: 56, Severity: high, Confidence: high, Category: performance
Message: "Large JSON parse blocks main thread"
Reasoning: "✓ Confirmed line 56: JSON.parse(hugeResponse)
✓ Response is 50MB (from API documentation)
✓ JSON.parse is synchronous
✓ Impact: UI freezes for several seconds during parse
✓ Severity: high (UI responsiveness)"
Suggestion: "Use streaming parser or Web Worker: const worker = new Worker(); worker.postMessage(data)"

✅ EXAMPLE 14: Missing Database Index Hint
Line: 167, Severity: high, Confidence: medium, Category: performance
Message: "Query on unindexed field causes full table scan"
Reasoning: "✓ Confirmed line 167: db.users.find({ lastLoginDate: { $gt: date } })
✓ Checked schema: lastLoginDate has no index
✓ users table has 1M+ rows
✓ Impact: Full table scan on every query
✓ Severity: high (slow queries, database load)"
Suggestion: "Add index on lastLoginDate or use indexed field"

✅ EXAMPLE 15: Repeated DOM Queries
Line: 112, Severity: medium, Confidence: high, Category: performance
Message: "DOM query repeated in loop"
Reasoning: "✓ Confirmed line 112: for (...) { document.getElementById('container').appendChild(...) }
✓ getElementById called every iteration
✓ DOM queries are expensive
✓ Impact: N DOM lookups vs 1
✓ Severity: medium (unnecessary DOM work)"
Suggestion: "Cache element: const container = document.getElementById('container'); for (...) container.appendChild(...)"

# BAD FINDINGS (DO NOT REPORT THESE)

❌ EXAMPLE 16: Security Issue
Line: 45, Message: "SQL injection vulnerability"
Why skip: Security issue, not performance. Report in security review.

❌ EXAMPLE 17: Logic Bug
Line: 78, Message: "Off-by-one error in loop"
Why skip: Correctness issue, not performance. Report in logic review.

❌ EXAMPLE 18: Code Style
Line: 12, Message: "Variable naming is unclear"
Why skip: Style issue, not performance.

❌ EXAMPLE 19: Micro-Optimization
Line: 56, Message: "Could use ++i instead of i++"
Why skip: Negligible performance difference, not worth reporting.

❌ EXAMPLE 20: Premature Optimization
Line: 89, Message: "Could cache this value that's accessed once"
Why skip: Single access doesn't benefit from caching.

❌ EXAMPLE 21: Already Optimized
Line: 145, Message: "Consider memoization"
Why skip: Didn't verify - function already memoized at call site.

# SELF-CHALLENGE REQUIREMENT

Before reporting ANY finding, challenge yourself:

1. **"Is the performance impact measurable?"**
   → Don't report micro-optimizations or theoretical concerns

2. **"Is this a hot path?"**
   → Cold code paths may not need optimization

3. **"Is this already optimized elsewhere?"**
   → Check for caching layers, CDNs, database indexes

4. **"What is the scale?"**
   → Small data sets may not need optimization

## Counter-Argument Documentation

For performance findings that could be questioned, document your self-challenge:

**Example 1 - Report After Challenge:**

Finding: "N+1 query pattern in user listing"

Counter-Argument Considered:
"Data might be cached or dataset is small enough"

Rebuttal:
"✓ Verified: No caching layer present (checked Redis/cache imports)
✓ Scale analysis: users table has 50k+ records (from migration comments)
✓ Hot path confirmed: Called on every page load (dashboard component)
✓ Impact: 50k DB queries vs 1 with batch loading"

Decision: ✅ **Report** (confirmed significant performance impact)

**Example 2 - Skip After Challenge:**

Finding: "Array.includes() in loop could use Set"

Counter-Argument Considered:
"Array size might be small enough that Set overhead isn't worth it"

Rebuttal:
"✓ Checked data: Array has max 5 items (from validation schema)
✓ Scale analysis: O(5) lookup is negligible
✓ Set overhead: Creating Set costs more than 5 array lookups
✓ Hot path check: Called once per form submit (not performance critical)"

Decision: ❌ **Don't report** (micro-optimization with no measurable impact)

# OUTPUT FORMAT

1. ANALYSIS: Document your performance analysis step-by-step
2. JSON: Strict format in markdown code block

\`\`\`json
{
  "file_results": {
    "path/to/file.ts": {
      "findings": [
        {
          "line": 45,
          "severity": "high",
          "confidence": "high",
          "category": "performance",
          "message": "Clear description of the performance issue",
          "suggestion": "Specific optimization with code example",
          "reasoning": "Complexity analysis, scale impact, verification notes",
          "isPreExisting": false
        }
      ]
    }
  }
}
\`\`\`

REMEMBER: Include entry for EVERY file listed, even with empty findings. Only report PERFORMANCE issues.
`;
}

/**
 * Builds a prompt for performance-focused cross-file analysis.
 * Focuses on system-level performance concerns across multiple files.
 */
export function buildPerformanceCrossFilePrompt(
  prDetails: PRDetails,
  context: PerformanceCrossFileContext,
  repoContext?: string,
  repoPath?: string
): string {
  const { filesSummary, fileReviewResults, existingCommentsContext } = context;

  const findingsSummary = fileReviewResults
    .filter((r) => r.findings.length > 0)
    .map((r) => `${r.filename}: ${r.findings.length} finding(s)`)
    .join("\n");

  const commentsSection = existingCommentsContext
    ? `\nEXISTING PR COMMENTS:\n${existingCommentsContext}\n\nIMPORTANT: Be aware of issues already flagged. Focus on NEW performance concerns not already covered.\n`
    : "";

  const repoContextSection = buildRepoContextSection(repoContext);
  const workspaceSection = repoPath
    ? `
---
# WORKSPACE ACCESS ENABLED

You have full access to the repository (not just changed files).
Your working directory is set to the repository root.

**Use these features extensively:**

- \`@workspace /search <query>\` - Find patterns across all files
- \`@file:relative/path/to/file.ts\` - Read any file in the repository
- \`@workspace /find <filename>\` - Locate files by name

**Critical for Performance Analysis:**

1. **Before flagging "missing caching":**
   \`@workspace /search cache\` to check for centralized caching layers

2. **Before reporting "no optimization":**
   \`@workspace /search optimization\` to find existing performance patterns

3. **Before claiming "inefficient":**
   \`@file:src/config.ts\` to check for performance configurations

4. **For architectural performance:**
   Explore existing performance patterns across the codebase

**MANDATORY:** Always cross-reference the repository before reporting:
- Caching might be handled centrally (Redis, CDN)
- Optimization might exist at infrastructure level
- Performance patterns might be framework-provided
- Database indexes might exist outside application code

---
`
    : "";

  return `# YOUR ROLE
Performance engineer performing system-level performance analysis of a pull request.
Your focus is on cross-file performance concerns and architectural performance issues.
${repoContextSection}${workspaceSection}
# PR CONTEXT
Title: ${prDetails.title}
Description: ${prDetails.description || "No description provided"}

Changed Files:
${filesSummary}

Individual File Performance Findings:
${findingsSummary || "No individual performance issues found"}
${commentsSection}
# CRITICAL SCOPE RESTRICTIONS

**ONLY REPORT** system-level performance issues. You MUST IGNORE:
- ❌ Single-file performance issues (already covered in file reviews)
- ❌ Security vulnerabilities
- ❌ Logic bugs
- ❌ Code quality concerns
- ❌ Architectural issues without performance impact

Focus on performance concerns that span multiple files or affect system-wide performance.

# CRITICAL RULES
1. ONLY analyze files in the Changed Files list above
2. Do NOT duplicate issues already caught in individual file reviews
3. Include confidence (high/medium/low) and reasoning for EVERY finding
4. Focus on system-level performance concerns across multiple files

# VERIFICATION CHECKLIST

Before reporting any cross-file performance finding, verify:

□ Issue spans multiple files (not a single-file concern)
□ Issue is NEW to this PR (not pre-existing performance debt)
□ Issue isn't already covered in individual file reviews
□ All affected files are actually in the Changed Files list
□ Issue has system-wide performance impact
□ Performance impact is measurable and significant
□ Severity matches the cross-file performance impact

## Verification Documentation Requirements

For EACH finding, your reasoning field must include:

- ✓ Cross-file confirmation: Which files and how they interact inefficiently
- ✓ Performance impact: Quantified impact on system performance
- ✓ Pattern check: Whether similar performance patterns exist elsewhere
- ✓ Integration verification: How components create performance bottlenecks together
- ✓ Scale analysis: Impact at realistic load levels
- ✓ Severity justification: Why this matters at the architecture level

**Example of proper verification in reasoning:**

    ✓ Confirmed: DataFetcher.ts queries individually, DataAggregator.ts loops over results
    ✓ Verified integration: N+1 pattern across components (N queries + N data transforms)
    ✓ Pattern check: Other fetchers use batch loading (UserFetcher, OrderFetcher)
    ✓ Performance impact: 1000 records = 1000 DB queries + 1000 transforms (2+ seconds)
    ✓ Scale analysis: Production has 10k+ records, unacceptable latency
    ✓ Severity justification: high (architectural N+1 pattern, user-facing latency)

# CROSS-FILE PERFORMANCE FOCUS AREAS

Analyze for these system-level performance concerns:

## 1. Distributed Performance Patterns
- N+1 queries spanning multiple services/modules
- Sequential operations that could be parallel
- Missing batching across component boundaries
- Cache invalidation cascades
- Redundant data fetching across layers

## 2. Resource Management Architecture
- Connection pool exhaustion across services
- Memory leaks spanning multiple components
- Unbounded queue growth in event systems
- Missing backpressure handling
- Resource contention between modules

## 3. Data Flow Inefficiency
- Data transformation chains creating bottlenecks
- Unnecessary serialization/deserialization across boundaries
- Large data passing through multiple layers
- Missing streaming where appropriate
- Redundant computations across components

## 4. Caching Architecture
- Inconsistent caching strategies across modules
- Cache stampede risks
- Missing cache warming
- Over-caching or under-caching patterns
- Cache invalidation inconsistencies

## 5. Frontend Performance Architecture
- Bundle splitting inefficiencies
- Missing code splitting between routes
- Redundant component re-renders across tree
- Props drilling causing unnecessary updates
- Missing virtualization for large lists

## 6. Database Performance Architecture
- Missing indexes for cross-table queries
- N+1 patterns in ORM relationships
- Inefficient join patterns
- Missing query optimization across services
- Transaction scope too broad/narrow

# SEVERITY THRESHOLDS
Use these exact criteria for cross-file performance issues:
- **critical**: System-wide performance degradation, production outage risk, user-facing timeout
- **high**: Significant cross-module inefficiency, scaling bottleneck, widespread impact
- **medium**: Architectural performance concern, optimization opportunity
- **low**: Minor cross-file efficiency improvement

# CONFIDENCE LEVELS
- **high**: Clear cross-file performance issue with measurable impact
- **medium**: Likely performance concern that needs profiling
- **low**: Potential performance concern based on general practices

# SELF-CHALLENGE REQUIREMENT

Before reporting ANY finding, challenge yourself:

1. **"Is this truly a cross-file performance issue?"**
   → Don't report single-file issues in cross-file analysis

2. **"Is this performance optimization at the right layer?"**
   → Example: CDN/infrastructure optimization, not application code

3. **"Is the performance impact measurable at scale?"**
   → Must have significant impact at realistic load

4. **"Is there architectural context I'm missing?"**
   → Example: Performance framework conventions

5. **"Would a performance engineer flag this?"**
   → Gut check: Substantive architectural bottleneck?

## Counter-Argument Documentation

For findings that could be questioned, document your self-challenge:

**Example 1 - Report After Challenge:**

Finding: "Sequential data fetching across service layers"

Counter-Argument Considered:
"Maybe sequential is intentional for data consistency"

Rebuttal:
"✓ Checked: No transaction requirements across these services
✓ Verified: Services are independent (UserService, ProfileService, SettingsService)
✓ Pattern analysis: Other service calls use Promise.all for parallel fetching
✓ Performance impact: 3 × 200ms = 600ms sequential vs 200ms parallel
✓ System impact: User-facing page load, significant latency at scale"

Decision: ✅ **Report** (architectural performance inefficiency confirmed)

**Example 2 - Skip After Challenge:**

Finding: "Different caching strategies in different modules"

Counter-Argument Considered:
"This might be intentional for different data characteristics"

Rebuttal:
"✓ Reviewed: Intentional strategy per module (user data: Redis, static: CDN, session: in-memory)
✓ Pattern verified: Each strategy appropriate for data access patterns
✓ Performance rationale: Different TTLs and invalidation needs documented
✓ No performance gap: Each module optimized for its use case"

Decision: ❌ **Don't report** (intentional performance architecture)

# OUTPUT FORMAT

Provide a complete cross-file performance analysis in JSON format:

\`\`\`json
{
  "findings": [
    {
      "severity": "high",
      "confidence": "high",
      "category": "performance",
      "message": "Clear description of cross-file performance issue",
      "affectedFiles": ["file1.ts", "file2.ts"],
      "reasoning": "Detailed verification of cross-file performance impact with scale analysis and evidence"
    }
  ],
  "overallAssessment": "Brief summary of PR's performance characteristics and architectural performance concerns",
  "recommendations": [
    "Actionable performance improvement suggestions"
  ]
}
\`\`\`

Focus on system-level performance: N+1 patterns across modules, resource management, caching architecture, data flow inefficiencies.
`;
}
