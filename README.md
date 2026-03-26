# Smart Memory

Persistent semantic memory for AI coding agents. Decisions, solutions, and context survive across sessions — works with Claude Code, Codex, Calwbot, Hermes, or any agent.

## Why

AI agents start every session with a blank slate. Smart Memory fixes that:

- **Remembers** architecture decisions, bug fixes, patterns, and project context
- **Auto-captures** command output and file reads with intelligent noise filtering
- **Hybrid search** — BM25 lexical + vector semantic search with score blending
- **Context management** — token-budgeted context generation and session snapshots
- **CLI** — `smart-memory-cli` for terminal access, scripting, and non-MCP agents
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

- **SessionStart hook** loads recent memories into the agent's context, prioritized by type (session snapshot > decisions > solutions > context > auto-captures)
- **PostToolUse hook** captures Bash/Read outputs (>= 200 chars) with noise filtering and 48h TTL. Errors and build results are auto-promoted to permanent storage. Git commits are stored permanently.
- **CLAUDE.md sync** adds usage instructions to `~/.claude/CLAUDE.md` on first use (versioned, auto-updates)
- **Cross-agent export** writes `AGENT-MEMORY-CONTEXT.md` to your project root on every session start and after each commit

### MCP Tools (8 tools)

| Tool | Purpose |
|---|---|
| `memory_store` | Save content with auto-embedding. Upserts by key. |
| `memory_search` | Hybrid BM25 + vector semantic search |
| `memory_query` | Filter by type, tags, date range |
| `memory_stats` | Total count, type breakdown, embedding coverage |
| `memory_delete` | Remove a memory by key |
| `memory_compact` | Generate embeddings for auto-captures, clean expired |
| `memory_context` | Token-budgeted context generation with relevance hints |
| `memory_snapshot` | Save/load session state across sessions |

### CLI

All operations are also available from the terminal via `smart-memory-cli`:

```bash
# Search memories
smart-memory-cli search "authentication strategy" --limit 5

# Store a memory
smart-memory-cli store "decision:auth" "Chose JWT over sessions" --type decision --tags auth,jwt

# Token-budgeted context
smart-memory-cli context --budget 4000 --hint "working on auth refactor"

# Save session state
smart-memory-cli snapshot save --summary "refactoring auth module" --pending "fix JWT,add tests"

# Load session state
smart-memory-cli snapshot load

# Query, stats, delete, compact
smart-memory-cli query --type decision
smart-memory-cli stats
smart-memory-cli delete "old-key"
smart-memory-cli compact
```

All commands support `--json` for machine-readable output and `--namespace` for cross-project access.

### Memory Types

```
memory_store key="decision:auth-strategy"  type="decision"  content="Chose JWT over sessions because..."
memory_store key="solution:race-condition"  type="solution"  content="Root cause was missing await in..."
memory_store key="context:api-design"      type="context"   content="The API follows REST conventions with..."
memory_store key="pattern:error-handling"   type="pattern"   content="All services use Result<T> pattern..."
```

### Context Management

**Recover after context compression:**
```
memory_context hint="what you were working on" budget_tokens=4000
```
Returns a token-budgeted markdown summary with the most relevant memories. Prioritizes hint matches, then decisions/solutions, then context/patterns.

**Save session state before ending:**
```
memory_snapshot action="save" summary="refactoring auth module" pending=["fix JWT", "add tests"]
```
Next session auto-loads the snapshot and uses it as a relevance hint for context loading.

**Load session state anytime:**
```
memory_snapshot action="load"
```

## Features

### Hybrid Search

Combines BM25 scoring (FTS5 full-text with column weights) and vector cosine similarity (Transformers.js MiniLM-L6-v2 embeddings, local — no API calls). Results are blended with configurable alpha, single-source penalties, and multiplicative recency boost. FTS5 queries are sanitized with stop-word filtering and CamelCase expansion.

### Noise Filtering

The PostToolUse hook skips noisy commands (`ls`, `pwd`, `git status`, `npm install`, etc.) and only captures meaningful output. Tiered error detection (typed exceptions > stack traces > exit codes) auto-promotes failures to permanent memory.

### Cross-Agent Context

`AGENT-MEMORY-CONTEXT.md` is auto-generated at your project root with the most valuable memories (limited to ~60 entries across 4 categories). Includes session snapshot state when available. Agents that don't support MCP — like Codex, Gemini, or Copilot — can read this file via `AGENTS.md` instructions.

### Worktree Support

Namespace is derived from `git rev-parse --git-common-dir`, so git worktrees share memory with the main repo automatically.

### Token-Saving Skill

The `/memory-manage` skill delegates mechanical memory operations (search, compact, stats) to a Sonnet subagent, saving ~80% of Opus tokens on memory ops.

## Architecture

```
server/src/
├── index.ts              MCP server entry point (8 tools)
├── cli.ts                CLI entry point (smart-memory-cli)
├── types.ts              Shared TypeScript types
└── memory/
    ├── search.ts         Orchestrator: store, search, query, context, snapshot, compact
    ├── database.ts       node:sqlite wrapper (WAL mode)
    ├── embeddings.ts     Transformers.js local embeddings (MiniLM-L6-v2)
    ├── vector-index.ts   Legacy vector index (migration only)
    └── schema.ts         DDL: tables, indexes, FTS5

scripts/
├── hook-session-start.js   SessionStart hook + snapshot-aware context loading
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
- `memory.db` — SQLite database (WAL mode, FTS5, embeddings as BLOBs)

No cloud APIs. No external dependencies beyond npm packages. Everything runs on your machine.

## Development

```bash
cd server && npm install && npm run build   # Build
cd server && npm test                        # Run server tests (Vitest, 24 tests)
node --test scripts/tests/hook-patterns.test.js  # Run hook pattern tests (89 tests)
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

## Author

Built by [xpm-cmd](https://github.com/xpm-cmd) with [Claude Code](https://claude.com/claude-code) as co-author.

## License

MIT
