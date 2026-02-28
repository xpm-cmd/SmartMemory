# Smart Memory — Project Guide

## Smart Memory is active in this project

MCP tools available: `memory_store`, `memory_search`, `memory_query`,
`memory_stats`, `memory_delete`, `task_plan`, `task_next`, `task_update`

---

## Rules for using Smart Memory

### At the START of every session

1. Run `memory_search query="[what the user is asking about]"` before
   exploring files or writing code. If similarity > 0.6, use that context.
2. Run `memory_query type="decision" limit=10` to load architecture decisions.

### STORE after important events

| Event | Command |
|---|---|
| Architecture or design decision | `memory_store key="decision:[topic]" content="..." type="decision"` |
| Bug fix with non-obvious solution | `memory_store key="solution:[bug]" content="..." type="solution"` |
| User explains domain context | `memory_store key="context:[topic]" content="..." type="context"` |
| Recurring pattern found | `memory_store key="pattern:[name]" content="..." type="pattern"` |

> Auto-capture is ON: Bash and Read outputs ≥ 100 chars are saved automatically.
> You do NOT need to manually store file contents or command outputs.

### WHEN to re-read a file instead of trusting memory

- Always before editing (Edit tool requires a fresh Read)
- When you modified the file in this session
- When the memory type is `auto-capture` and the task requires exact current content

### WHEN memory is reliable without re-reading

- `type="decision"` — architectural choices written consciously
- `type="solution"` — resolved bugs and workarounds
- `type="context"` — domain knowledge explained by the user

---

## Task planning

For multi-step work, use the task system:
```
task_plan tasks=[{id, title, priority, dependencies[]}]
task_next   → returns the next available task respecting dependencies
task_update id="..." status="in_progress|completed|blocked"
```
Tasks persist across sessions — a plan started today continues tomorrow.
