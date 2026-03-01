/**
 * Smart Memory — CLAUDE.md auto-sync.
 * Ensures ~/.claude/CLAUDE.md has up-to-date Smart Memory instructions.
 * Runs on every SessionStart; only writes when version changes.
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const CURRENT_VERSION = '2.1.0';
const VERSION_MARKER = '<!-- SMART_MEMORY_VERSION: ';
const SECTION_START = '## Smart Memory';
const SECTION_END_MARKER = '<!-- /SMART_MEMORY -->';

const TEMPLATE = `## Smart Memory

${VERSION_MARKER}${CURRENT_VERSION} -->

6 tools: \`memory_store\`, \`memory_search\`, \`memory_query\`, \`memory_stats\`, \`memory_delete\`, \`memory_compact\`

### Store proactively during work

Save understanding as you go — don't wait for a commit. Compaction erases reasoning.

\`\`\`
memory_store key="decision:[topic]"  type="decision"   # design choices, architectural calls
memory_store key="solution:[bug]"    type="solution"   # non-obvious fixes, root causes found
memory_store key="context:[topic]"   type="context"    # how something works, why it's built that way
memory_store key="pattern:[name]"    type="pattern"    # recurring patterns discovered
\`\`\`

**Store immediately when you:**
- Understand how a complex system works (before you forget after compaction)
- Choose between approaches (store the choice AND the reasoning)
- Find a root cause or non-obvious fix
- Discover a codebase pattern or convention

Bash/Read outputs ≥ 200 chars are auto-saved (48h TTL). Errors and test results are auto-promoted to permanent.

### After context compaction

When you see compressed/summarized prior messages, recover details:
1. \`memory_search query="[current task topic]"\` — find relevant memories
2. \`memory_query type="decision"\` — reload architectural decisions
3. Re-read critical files before editing (compaction loses exact content)

### Trust rules

- Re-read file before editing it (always)
- Trust \`decision\`/\`solution\`/\`context\` memories without re-reading
- Re-read \`auto-capture\` memories if exact content matters

${SECTION_END_MARKER}`;

/**
 * Ensure CLAUDE.md has the Smart Memory section at the correct version.
 * - If missing → append the section
 * - If outdated → replace only the Smart Memory section
 * - If current → no-op
 */
export function syncClaudeMd() {
  const claudeDir = join(homedir(), '.claude');
  const claudeMdPath = join(claudeDir, 'CLAUDE.md');

  // Ensure ~/.claude/ exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  let content = '';
  if (existsSync(claudeMdPath)) {
    content = readFileSync(claudeMdPath, 'utf-8');
  }

  // Check if already at current version
  const versionMatch = content.match(new RegExp(VERSION_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([\\d.]+)'));
  if (versionMatch && versionMatch[1] === CURRENT_VERSION) {
    return; // Already up-to-date
  }

  // Find and replace existing Smart Memory section, or append
  const startIdx = content.indexOf(SECTION_START);
  const endIdx = content.indexOf(SECTION_END_MARKER);

  let newContent;
  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section (preserve everything before and after)
    const before = content.slice(0, startIdx).trimEnd();
    const after = content.slice(endIdx + SECTION_END_MARKER.length).trimStart();
    newContent = (before ? before + '\n\n' : '') + TEMPLATE + (after ? '\n\n' + after : '') + '\n';
  } else if (startIdx !== -1) {
    // Section exists but no end marker (legacy) — replace from start to end of file
    // or to next ## heading
    const afterStart = content.slice(startIdx);
    const nextHeading = afterStart.indexOf('\n## ', 1);
    if (nextHeading !== -1) {
      const before = content.slice(0, startIdx).trimEnd();
      const after = afterStart.slice(nextHeading).trimStart();
      newContent = (before ? before + '\n\n' : '') + TEMPLATE + '\n\n' + after + '\n';
    } else {
      // Smart Memory is the last section — replace to end
      const before = content.slice(0, startIdx).trimEnd();
      newContent = (before ? before + '\n\n' : '') + TEMPLATE + '\n';
    }
  } else {
    // No Smart Memory section — append
    newContent = (content.trimEnd() ? content.trimEnd() + '\n\n' : '') + TEMPLATE + '\n';
  }

  try {
    writeFileSync(claudeMdPath, newContent, 'utf-8');
  } catch {
    // Non-critical — don't fail the session
  }
}
