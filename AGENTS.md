# Agent Instructions

## Project Context

Before starting any task, read `AGENT-MEMORY-CONTEXT.md` in the repo root.
It contains architecture decisions, solutions, and project context
from previous development sessions. It is auto-generated on every
Claude Code session start and after each commit.

If `AGENT-MEMORY-CONTEXT.md` doesn't exist yet, read `CLAUDE.md` for
architecture overview and conventions.

## Key Architecture

- **MCP Server**: `server/src/index.ts` — 8 tools (store, search, query, stats, delete, compact, context, snapshot)
- **Memory Engine**: `server/src/memory/search.ts` — hybrid search (FTS5 + vector), store, compact
- **Embeddings**: `server/src/memory/embeddings.ts` — local vector generation via Transformers.js
- **Database**: `server/src/memory/database.ts` — SQLite via node:sqlite (WAL mode)
- **Hooks**: `scripts/hook-session-start.js` (context load + export), `scripts/hook-post-tool.js` (auto-capture)
- **Shared modules**: `scripts/lib/export-context.js`, `scripts/lib/claudemd-sync.js`

## Conventions

- TypeScript strict mode, ESM modules
- Version source of truth: `.claude-plugin/plugin.json`
- Server tests: `cd server && npm test` (Vitest)
- Hook tests: `node --test scripts/tests/hook-patterns.test.js` (node:test)
- Build: `cd server && npm run build`
- Node >= 22.5 required (uses built-in `node:sqlite`)

## Context Management Tools

### memory_context — Token-budgeted context generation

Use when: recovering from context compression, starting work on a topic, or need relevant memories fast.

```
memory_context hint="authentication refactor" budget_tokens=4000
```

Returns formatted markdown with the most relevant memories, respecting the token budget.
Prioritizes: hint-matched results > decisions/solutions > context/patterns.

### memory_snapshot — Session state save/load

Use when: ending a session, context getting large, or resuming from a previous session.

**Save:**
```
memory_snapshot action="save" summary="refactoring auth module" pending=["fix JWT validation", "add unit tests"]
```

**Load:**
```
memory_snapshot action="load"
```

Returns the last saved session state (summary + pending tasks). Auto-loaded at session start if available.
