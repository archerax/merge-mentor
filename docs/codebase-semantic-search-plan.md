# 🔍 Codebase-Wide Semantic Search Implementation Plan

This plan details how to implement codebase-wide semantic search capabilities in Merge Mentor, optimized specifically for **large monorepos (>100K files)** and **minimal API costs**.

---

## ⚡ Monorepo & Cost Optimization Architecture

Standard vector search architectures fail on large monorepos because indexing 100,000+ files is computationally expensive, memory-heavy, and cost-prohibitive when using commercial APIs. To solve this, we use a hybrid, PR-scoped approach.

### 1. Zero-Cost Local Embeddings

To avoid cloud API token costs, the system supports generating embeddings locally:

- **Local ONNX Model:** Use a lightweight, pure JavaScript library (such as `@xenova/transformers`) to run models like `all-MiniLM-L6-v2` or `bge-small-en-v1.5` directly on the developer's CPU. The model is downloaded once (~100MB) and runs locally with **$0.00** API fees.
- **Local Ollama Integration:** Support local nomic-embed-text models running via Ollama.

### 2. PR-Scoped Indexing (Workspace Segmenting)

Instead of building a single 100,000-file index, we partition the database:

- **Sub-Workspace Discovery:** When running a PR review, identify which directories are modified in the git diff (e.g., `apps/billing-service/` and `libs/auth-helper/`).
- **Dynamic Sparse Indexing:** Only index and load files within the modified directories and their explicitly imported monorepo dependencies.
- **Configurable Path Rules:** Exclude build folders, assets, documentation, and external libraries. Configure `indexPaths` in `.mergementor.json` to limit search scope.

### 3. SQLite Database Storage

Instead of storing embeddings in giant flat JSON files—which cause high memory usage and block the Node.js event loop during parsing—we store them in a single, local SQLite database at `.mergementor/embeddings.db`.

- **Native Node.js 22 Support:** We leverage Node 22's native `node:sqlite` module, requiring **zero external dependencies** and no native binary compilations in CI.
- **Efficient Binary Vectors:** Vectors are serialized as raw binary `Float32Array` buffers (BLOBs), reducing storage size by 75% compared to stringified JSON arrays.
- **Indexed Queries:** SQL indexes allow us to fetch embeddings for specific directories or workspace segments in microseconds without loading the entire 100K-file database into memory.

---

## 🛠️ Step 1: Storage & SQLite Schema

### 1. Database Location

Save the database to `.mergementor/embeddings.db`.

### 2. Database Schema

Initialize the database using the following tables and indexes:

```sql
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  workspace_segment TEXT NOT NULL,
  last_indexed INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text_chunk TEXT NOT NULL,
  vector BLOB NOT NULL, -- Binary Float32Array (384/1536 floats)
  FOREIGN KEY (file_path) REFERENCES files(path) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_files_segment ON files(workspace_segment);
CREATE INDEX IF NOT EXISTS idx_embeddings_file ON embeddings(file_path);
```

### 3. Binary Vector Serialization Helper

```typescript
export function vectorToBlob(vector: readonly number[]): Buffer {
  const floatArray = new Float32Array(vector);
  return Buffer.from(floatArray.buffer);
}

export function blobToVector(blob: Buffer): number[] {
  const floatArray = new Float32Array(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength / 4,
  );
  return Array.from(floatArray);
}
```

---

## 🛠️ Step 2: Embedding Generation via BYOK / Local Client

We will extend the AI provider abstraction to support embedding generation, allowing users to toggle between local ONNX running on CPU or BYOK cloud clients.

### 1. Provider Extension ([src/ai/types.ts](file:///root/merge-mentor/src/ai/types.ts))

```typescript
export interface AiProvider {
  // ... existing methods
  generateEmbedding(text: string): Promise<readonly number[]>;
}
```

### 2. Local ONNX Provider Example

```typescript
import { pipeline } from "@xenova/transformers";

export class LocalEmbeddingProvider {
  private extractor: any;

  async init() {
    this.extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );
  }

  async generateEmbedding(text: string): Promise<readonly number[]> {
    const output = await this.extractor(text, {
      pooling: "mean",
      normalize: true,
    });
    return Array.from(output.data);
  }
}
```

---

## 🛠️ Step 3: Indexing Command

### 1. Command Syntax

```bash
merge-mentor index [--pr <prNumber>] [--paths <paths>] [--force]
```

### 2. Indexing Flow & SQLite Integration

We initialize the database connection and update changed files transactionally:

```typescript
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(".mergementor/embeddings.db");

export async function indexWorkspace(filesToScope: string[]) {
  const getFileStmt = db.prepare(
    "SELECT content_hash FROM files WHERE path = ?",
  );
  const deleteFileStmt = db.prepare("DELETE FROM files WHERE path = ?");

  const insertFileStmt = db.prepare(
    "INSERT INTO files (path, content_hash, workspace_segment, last_indexed) VALUES (?, ?, ?, ?)",
  );
  const insertEmbeddingStmt = db.prepare(
    "INSERT INTO embeddings (file_path, chunk_index, text_chunk, vector) VALUES (?, ?, ?, ?)",
  );

  for (const filePath of filesToScope) {
    const currentHash = calculateSHA256(filePath);
    const existing = getFileStmt.get(filePath) as
      { content_hash: string } | undefined;

    if (existing && existing.content_hash === currentHash) {
      continue; // File hasn't changed, skip embedding generation
    }

    // Delete old record and its cascading embeddings
    deleteFileStmt.run(filePath);

    // Compute new chunks and embeddings
    const chunks = chunkFile(filePath);
    insertFileStmt.run(filePath, currentHash, getSegment(filePath), Date.now());

    for (let i = 0; i < chunks.length; i++) {
      const vector = await provider.generateEmbedding(chunks[i]);
      insertEmbeddingStmt.run(filePath, i, chunks[i], vectorToBlob(vector));
    }
  }
}
```

---

## 🛠️ Step 4: AI Tool Registration

To make the AI agent codebase-aware, register the `semanticSearch` tool.

### 1. Tool Schema Definition ([src/ai/tools/index.ts](file:///root/merge-mentor/src/ai/tools/index.ts))

```typescript
import { z } from "zod";

export const SemanticSearchToolSchema = {
  name: "semanticSearch",
  description: "Search relevant parts of the active workspaces semantically.",
  parameters: z.object({
    query: z
      .string()
      .describe(
        "The description or search term of the code pattern/definition to locate.",
      ),
    limit: z.number().int().positive().optional().default(5),
  }),
};
```

### 2. Tool Implementation & Cosine Similarity

When the AI invokes `semanticSearch`, query only the active workspace segments:

```typescript
import { DatabaseSync } from "node:sqlite";

export async function handleSemanticSearch(
  query: string,
  activeSegments: string[],
  limit: number,
) {
  const db = new DatabaseSync(".mergementor/embeddings.db");
  const queryVector = await provider.generateEmbedding(query);

  // Generate placeholder parameters for workspace segments
  const placeholders = activeSegments.map(() => "?").join(",");
  const queryEmbeddings = db.prepare(`
    SELECT file_path, text_chunk, vector 
    FROM embeddings 
    WHERE file_path IN (
      SELECT path FROM files WHERE workspace_segment IN (${placeholders})
    )
  `);

  const rows = queryEmbeddings.all(...activeSegments) as Array<{
    file_path: string;
    text_chunk: string;
    vector: Buffer;
  }>;

  // Calculate cosine similarity locally in memory
  const results = rows.map((row) => {
    const docVector = blobToVector(row.vector);
    const score = cosineSimilarity(queryVector, docVector);
    return { filePath: row.file_path, textChunk: row.text_chunk, score };
  });

  // Sort and return top matches
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
```

---

## 🛠️ Step 5: Hybrid Search Fallback (Cost & Speed Control)

To ensure high performance and low LLM costs:

1. **Instruct the Agent:** Prompt the AI model to prioritize the local, zero-token `grep` tool (which searches for exact definitions/imports in milliseconds via `ripgrep`) first.
2. **Fallback to Semantic Search:** Instruct the agent to call the `semanticSearch` tool only if exact symbol lookup fails or if it needs to query high-level design patterns (e.g., _"Find examples of database transaction safety in this workspace"_).
