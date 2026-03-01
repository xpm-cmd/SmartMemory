# Smart Memory

Persistent semantic memory for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Decisions, solutions, and context survive across sessions — no setup required beyond install.

## Why

Claude Code starts every session with a blank slate. Smart Memory fixes that:

- **Remembers** architecture decisions, bug fixes, patterns, and project context
- **Auto-captures** command output and file reads with intelligent noise filtering
- **Loads context** at session start so Claude picks up where it left off
- **Exports** `AGENT-MEMORY-CONTEXT.md` for agents without MCP access (Codex, Gemini, Copilot)

## Quick Start

### Option 1: Plugin (recommended)

Requires [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and **Node >= 22.5**.

```bash
# Register as a local marketplace
claude plugin marketplace add https://github.com/xpm-cmd/SmartMemory

# Install the plugin
claude plugin install smart-memory@smart-memory-local
```

That's it. The plugin auto-configures MCP server, hooks, and skills. On first session, it adds usage instructions to `~/.claude/CLAUDE.md` automatically.

### Option 2: Manual setup

```bash
git clone https://github.com/xpm-cmd/SmartMemory.git
cd SmartMemory/server && npm install && npm run build
```

Register the MCP server:

```bash
claude mcp add smart-memory node /path/to/SmartMemory/server/dist/index.js
```

Add hooks to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/SmartMemory/scripts/hook-session-start.js"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|Read",
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/SmartMemory/scripts/hook-post-tool.js"
          }
        ]
      }
    ]
  }
}
```

## How It Works

### Automatic (no action needed)

- **SessionStart hook** loads recent memories into Claude's context at the start of every session, prioritized by type (decisions > solutions > context > auto-captures)
- **PostToolUse hook** captures Bash/Read outputs (>= 200 chars) with noise filtering and 48h TTL. Errors and build results are auto-promoted to permanent storage. Git commits are stored permanently.
- **CLAUDE.md sync** adds usage instructions to `~/.claude/CLAUDE.md` on first use (versioned, auto-updates)
- **Cross-agent export** writes `AGENT-MEMORY-CONTEXT.md` to your project root on every session start and after each commit

### Manual (Claude uses these as needed)

| Tool | Purpose |
|---|---|
| `memory_store` | Save content with auto-embedding. Upserts by key. |
| `memory_search` | Semantic similarity + FTS5 keyword hybrid search |
| `memory_query` | Filter by type, tags, date range |
| `memory_stats` | Total count, type breakdown, embedding coverage |
| `memory_delete` | Remove a memory by key |
| `memory_compact` | Generate embeddings for auto-captures, clean expired |

### Memory Types

```
memory_store key="decision:auth-strategy"  type="decision"  content="Chose JWT over sessions because..."
memory_store key="solution:race-condition"  type="solution"  content="Root cause was missing await in..."
memory_store key="context:api-design"      type="context"   content="The API follows REST conventions with..."
memory_store key="pattern:error-handling"   type="pattern"   content="All services use Result<T> pattern..."
```

## Features

### Hybrid Search

Combines FTS5 full-text search with vector similarity (Transformers.js embeddings, local — no API calls). Results are ranked by a weighted combination of both signals.

### Noise Filtering

The PostToolUse hook skips noisy commands (`ls`, `pwd`, `git status`, `npm install`, etc.) and only captures meaningful output. Tiered error detection (typed exceptions > stack traces > exit codes) auto-promotes failures to permanent memory.

### Cross-Agent Context

`AGENT-MEMORY-CONTEXT.md` is auto-generated at your project root with the most valuable memories (limited to ~60 entries across 4 categories). Agents that don't support MCP — like Codex, Gemini, or Copilot — can read this file via `AGENTS.md` instructions.

### Worktree Support

Namespace is derived from `git rev-parse --git-common-dir`, so git worktrees share memory with the main repo automatically.

### Token-Saving Skill

The `/memory-manage` skill delegates mechanical memory operations (search, compact, stats) to a Sonnet subagent, saving ~80% of Opus tokens on memory ops.

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
├── hook-session-start.js   SessionStart hook + context export
├── hook-post-tool.js       PostToolUse auto-capture hook
├── lib/
│   ├── export-context.js   AGENT-MEMORY-CONTEXT.md generator
│   └── claudemd-sync.js   ~/.claude/CLAUDE.md auto-sync
└── tests/
    └── hook-patterns.test.js   89 tests for noise/error/success patterns

skills/
└── memory-manage/
    └── SKILL.md            /memory-manage skill (Sonnet delegation)
```

## Storage

All data lives locally in `~/.smart-memory/{namespace}/`:
- `memory.db` — SQLite database (WAL mode, FTS5)
- `index.bin` — Serialized vector index

No cloud APIs. No external dependencies beyond npm packages. Everything runs on your machine.

## Development

```bash
cd server && npm install && npm run build   # Build
cd server && npm test                        # Run server tests (Vitest)
node --test scripts/tests/hook-patterns.test.js  # Run hook pattern tests
```

## Uninstall

```bash
# Remove plugin
claude plugin remove smart-memory@smart-memory-local

# Remove marketplace
claude plugin marketplace remove smart-memory-local

# Remove data (optional)
rm -rf ~/.smart-memory
```

The CLAUDE.md section can be removed manually — look for `## Smart Memory` through `<!-- /SMART_MEMORY -->`.

## License

MIT
