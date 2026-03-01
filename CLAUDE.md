# Smart Memory — Development Guide

## Project overview

Smart Memory is a Claude Code plugin that provides persistent semantic memory across sessions. It consists of an MCP server (6 tools), two hooks (SessionStart + PostToolUse), and a Sonnet-delegation skill.

## Architecture

- **MCP Server**: `server/src/index.ts` — routes tool calls to `memory/search.ts`
- **Search Engine**: `server/src/memory/search.ts` — hybrid FTS5 + vector search, store, compact
- **Database**: `server/src/memory/database.ts` — node:sqlite with WAL mode
- **Embeddings**: `server/src/memory/embeddings.ts` — Transformers.js (local, no API)
- **Vector Index**: `server/src/memory/vector-index.ts` — brute-force dot product
- **SessionStart Hook**: `scripts/hook-session-start.js` — loads context + exports AGENT-MEMORY-CONTEXT.md
- **PostToolUse Hook**: `scripts/hook-post-tool.js` — auto-captures Bash/Read output, promotes errors

## Key conventions

- TypeScript strict mode, ESM modules throughout
- Version source of truth: `.claude-plugin/plugin.json` (read dynamically by server + hooks)
- Tests: Vitest for server (`cd server && npm test`), node:test for hooks (`node --test scripts/tests/hook-patterns.test.js`)
- Node >= 22.5 required (uses built-in `node:sqlite`)
- Hooks are plain JS (no build step), server is TypeScript

## Memory types

| Type | Purpose | Stored by |
|---|---|---|
| `decision` | Architecture choices and reasoning | Claude (manual) |
| `solution` | Bug fixes, root causes, workarounds | Claude (manual) |
| `context` | Domain knowledge, how things work | Claude (manual) |
| `pattern` | Recurring patterns and conventions | Claude (manual) |
| `auto-capture` | Bash/Read output | PostToolUse hook (auto) |

## Auto-capture behavior

- PostToolUse captures Bash/Read output >= 200 chars
- Noise filtered: `ls`, `pwd`, `git status`, `npm install`, etc. are skipped
- TTL: 48h for regular auto-captures, permanent for errors and git commits
- Error detection: 3 tiers (typed exceptions > stack traces > exit codes)
- Errors and build results are auto-promoted to permanent (no TTL)

## Cross-agent export

`AGENT-MEMORY-CONTEXT.md` is generated at project root with per-type limits:
- decision: 20, solution: 20, context: 10, pattern: 10 (max ~60 entries)
- Regenerated on SessionStart and after each git commit
