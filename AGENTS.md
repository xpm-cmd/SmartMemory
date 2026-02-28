# Agent Instructions

## Project Context (Smart Memory)

Before starting any task, read `CONTEXT.md` in the repo root.
It contains architecture decisions, solutions, and project context
from previous development sessions. It is auto-generated on every
Claude Code session start.

## Key Architecture

- **MCP Server**: `server/src/index.ts` — 6 tools (store, search, query, stats, delete, compact)
- **Memory Engine**: `server/src/memory/search.ts` — hybrid search (FTS5 + vector), store, compact
- **Embeddings**: `server/src/memory/embeddings.ts` — vector generation via Transformers.js
- **Vector Index**: `server/src/memory/vector-index.ts` — brute-force cosine/dot product
- **Database**: `server/src/memory/database.ts` — SQLite via node:sqlite (Node >= 22.5)
- **Hooks**: `scripts/hook-session-start.js` (loads context + exports CONTEXT.md), `scripts/hook-post-tool.js` (auto-capture)

## Conventions

- TypeScript strict mode, ESM modules
- Tests in `server/src/tests/` using Vitest
- Build: `cd server && npm run build`
- Test: `cd server && npm test`
- Node >= 22.5 required (uses built-in `node:sqlite`)
