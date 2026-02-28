---
name: memory-manage
description: >
  Use this skill to efficiently manage Smart Memory using a Sonnet subagent.
  Triggers on: "manage memory", "memory sync", "compact memory", "check memory",
  "memory status", or at session start when CLAUDE.md instructs memory operations.
  Delegates all memory tool calls (search, compact, stats, query) to a cheaper
  Sonnet model to save Opus tokens.
---

# Memory Manage — Sonnet-Delegated Memory Operations

## Purpose

This skill saves expensive Opus tokens by delegating mechanical memory
operations to a Sonnet subagent. Opus reads these instructions (~50 tokens)
and dispatches one Task call (~20 tokens). Sonnet handles the rest.

## When to Use

- At the START of every session (instead of Opus calling memory tools directly)
- When the user asks to check, sync, or compact memory
- When SessionStart hook reports low embedding coverage
- Before a long session ends (to save a session summary)

## How to Execute

**IMPORTANT:** Always use `model: "sonnet"` for the Task to save Opus tokens.

### For session start context loading:

```
Task(
  model: "sonnet",
  subagent_type: "general-purpose",
  description: "Load memory context",
  prompt: `You are a memory management agent. Execute these steps using the Smart Memory MCP tools:

1. Run memory_stats to check total memories and embedding coverage
2. If embedding_coverage < 0.8, run memory_compact to index unembedded memories
3. Run memory_search with query="[TOPIC]" to find relevant context
   (replace [TOPIC] with what the user is working on)
4. Run memory_query with type="decision" and limit=10 to load architecture decisions

Report back a concise summary:
- How many memories exist, embedding coverage %
- Any relevant decisions or context found
- Whether compact was needed and results
Format as a brief bullet list, not verbose.`
)
```

### For session summary (before session ends):

```
Task(
  model: "sonnet",
  subagent_type: "general-purpose",
  description: "Save session summary",
  prompt: `You are a memory management agent. Save a session summary using memory_store:

memory_store(
  key: "session:YYYY-MM-DD:summary",
  type: "context",
  content: "[SUMMARY]",
  tags: ["session", "summary", "auto"]
)

The summary should include:
- What was built or discussed
- Key decisions made
- Current state of the work
- Suggested next steps

Replace YYYY-MM-DD with today's date and [SUMMARY] with the actual summary.`
)
```

### For manual memory check:

```
Task(
  model: "sonnet",
  subagent_type: "general-purpose",
  description: "Memory health check",
  prompt: `Run a full memory health check:
1. memory_stats — report totals and coverage
2. memory_compact — if any unembedded memories exist
3. memory_query with limit=5 — show 5 most recent memories
4. Report results concisely.`
)
```

## What Opus Should Still Do Directly

- `memory_store` for decisions, solutions, patterns — these require Opus-level
  judgment about what's important and how to phrase it
- Reading memory results and deciding next actions

## Token Impact

| Operation | Without skill | With skill |
|-----------|--------------|------------|
| Session start context | ~500 Opus tokens (3-4 tool calls) | ~70 Opus tokens (1 Task dispatch) + ~500 Sonnet tokens |
| Memory compact | ~200 Opus tokens | ~50 Opus + ~200 Sonnet |
| Session summary | ~300 Opus tokens | ~50 Opus + ~300 Sonnet |
| **Net savings** | — | **~80% Opus reduction** for memory ops |
