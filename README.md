# Smart Memory

Persistent semantic memory for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Decisions, solutions, and context survive across sessions. Auto-exports `CONTEXT.md` for cross-agent use (Codex, Gemini, etc.).

## What it does

- **Stores** architecture decisions, solutions, patterns, and context
- **Searches** via FTS5 full-text + vector similarity (hybrid)
- **Auto-captures** Bash/Read output with noise filtering and 48h TTL
- **Loads context** at session start via tiered hooks (decisions first, noise last)
- **Exports** `CONTEXT.md` automatically for non-MCP agents

## Installation

Requires **Node >= 22.5** (uses built-in `node:sqlite`).

```bash
cd server && npm install && npm run build
```

Register as MCP server in Claude Code:

```bash
claude mcp add smart-memory node /path/to/SmartMemory/server/dist/index.js
```

Configure hooks in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "command": "node /path/to/SmartMemory/scripts/hook-session-start.js" }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|Read",
        "command": "node /path/to/SmartMemory/scripts/hook-post-tool.js"
      }
    ]
  }
}
```

## MCP Tools

| Tool | Purpose |
|---|---|
| `memory_store` | Save content with auto-embedding. Upserts by key. |
| `memory_search` | Semantic + keyword hybrid search |
| `memory_query` | Filter by type, tags, date range |
| `memory_stats` | Total count, type breakdown, embedding coverage |
| `memory_delete` | Remove a memory by key |
| `memory_compact` | Generate embeddings for auto-captures, clean expired |

## Hooks

**SessionStart** — Loads recent memories into Claude Code context (tiered by priority) and writes `CONTEXT.md` to disk for cross-agent use.

**PostToolUse** — Auto-captures Bash/Read output (≥200 chars, noise-filtered, 48h TTL). Git commits are stored permanently.

## Memory Types

```
memory_store key="decision:auth-strategy"  type="decision"  content="..."
memory_store key="solution:race-condition"  type="solution"  content="..."
memory_store key="context:api-design"      type="context"   content="..."
memory_store key="pattern:error-handling"   type="pattern"   content="..."
```

## Architecture

```
server/src/
├── index.ts              MCP server entry point (6 tools)
├── types.ts              Shared TypeScript types
└── memory/
    ├── search.ts         Orchestrator: store, search, query, compact
    ├── database.ts       node:sqlite wrapper (WAL mode)
    ├── embeddings.ts     Transformers.js local embeddings
    ├── vector-index.ts   Brute-force vector search (dot product)
    └── schema.ts         DDL: tables, indexes, FTS5

scripts/
├── hook-session-start.js   SessionStart hook + CONTEXT.md export
└── hook-post-tool.js       PostToolUse auto-capture hook

skills/
└── memory-manage/
    └── SKILL.md            /memory-manage skill (Sonnet delegation)
```

## Storage

All data lives in `~/.smart-memory/{namespace}/`:
- `memory.db` — SQLite database (WAL mode)
- `index.bin` — Serialized vector index

Namespace is derived from the git repo root (`git rev-parse --git-common-dir`), so worktrees share memory with the main repo.

## License

MIT
