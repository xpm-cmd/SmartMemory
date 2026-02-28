# Agent Instructions

## Project Context (Smart Memory)

Before starting any task, read `CONTEXT.md` in the repo root.
It contains architecture decisions, solutions, and project context
from previous development sessions.

To regenerate it with latest data:
```bash
node scripts/export-context.js
```

## Key Architecture

- **MCP Server**: `server/src/index.ts` — entry point, tool definitions
- **Memory Engine**: `server/src/memory/search.ts` — search, store, compact
- **Embeddings**: `server/src/memory/embeddings.ts` — vector generation via Anthropic API
- **Vector Index**: `server/src/memory/hnsw.ts` — HNSW approximate nearest neighbor
- **Database**: `server/src/memory/db.ts` — SQLite via node:sqlite (Node >= 22.5)
- **Hooks**: `scripts/hook-session-start.js`, `scripts/hook-post-tool.js`
- **Export**: `scripts/export-context.js` — generates CONTEXT.md for cross-agent use

## Conventions

- TypeScript strict mode, ESM modules
- Tests in `server/src/__tests__/` using Vitest
- Build: `cd server && npm run build`
- Test: `cd server && npm test`
- Node >= 22.5 required (uses built-in `node:sqlite`)
