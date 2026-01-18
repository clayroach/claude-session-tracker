# Lua Implementation Reference

Reference document for porting the Hammerspoon/Lua Claude Session Tracker to Electron + Effect-TS.

## Architecture Overview

```
init.lua          # Orchestration: gather_sessions(), hotkey binding
├── config.lua    # Configuration constants
├── tmux.lua      # tmux session discovery and control
├── claude.lua    # JSONL file parsing and status detection
├── llm.lua       # Local LLM integration (LM Studio)
├── panel.lua     # WebView panel management
├── html.lua      # HTML/CSS template generation
├── utils.lua     # Shared utilities
└── capture.lua   # Permission prompt logging
```

## Data Flow

1. **Discovery**: `init.gather_sessions()` calls `tmux.get_sessions()`
2. **Mapping**: Filesystem path → Claude project directory (`-Users-croach-projects-foo`)
3. **Session Finding**: `claude.find_all_sessions(project_dir)` locates JSONL files by mtime
4. **Parsing**: `claude.parse_session(jsonl_path)` extracts tokens, messages, status
5. **LLM Analysis**: `llm.analyze_session()` async analyzes for intelligent status/summary
6. **Rendering**: `html.generate_html()` builds panel content

## Module Details

### tmux.lua

**Key Functions:**
- `get_sessions()` → `{ [name]: { path, attached } }`
- `capture_pane(session, window)` → last 50 lines of terminal
- `focus_session(session, window)` → switch + activate terminal app
- `get_github_repo(path)` → parse git remote for repo name
- `detect_pane_state(content)` → pattern-based status from terminal output

**tmux Commands:**
```bash
# List sessions with metadata
tmux list-sessions -F '#{session_name}|||#{session_path}|||#{session_attached}'

# Capture pane content
tmux capture-pane -t 'session:window' -p -S -50

# Get windows for session
tmux list-windows -t 'session' -F '#{window_index}\t#{window_name}'
```

**Pane State Patterns:**
- Permission: `"Do you want to"`, `"Esc to cancel"`
- Working: `"ctrl+c to interrupt"`, spinner chars `✶✷✸✹✺✻✼✽`, `"thinking)"`
- Waiting: `"Sauté'd for"`, `"Worked for"`, `"Cost:"`, prompt `❯`
- Error: `"Error:"`, `"error:"`, `"failed"`

### claude.lua

**Key Functions:**
- `find_all_sessions(project_dir, max, max_age_hours)` → recent JSONL files
- `parse_session(jsonl_path)` → session data object
- `calculate_context_percent(data, model)` → 0-100%
- `determine_status(data, is_attached, last_activity_seconds)` → status + detail
- `generate_summary(messages, assistant_messages, max_length)` → text

**JSONL Parsing Strategy:**
```lua
-- Efficient for large files: read tail + head separately
local cmd = string.format("tail -100 '%s' 2>/dev/null", jsonl_path)  -- Recent entries
local cmd_head = string.format("head -10 '%s' 2>/dev/null", jsonl_path)  -- Metadata
```

**Session Data Structure:**
```lua
{
  tokens = { input, output, cache_read, total },
  messages = {},           -- User messages for summary
  assistant_messages = {}, -- Assistant text responses
  model = "claude-opus-4-5-...",
  slug = "session-slug",
  git_branch = "main",
  session_id = "uuid",
  last_timestamp = 1736977975,
  active_tool = "Bash",     -- Currently executing tool
  pending_tool = "Edit",    -- Tool awaiting permission
  pending_tool_ids = {},    -- Map of tool_use_id -> tool_info
  current_context = 150000, -- Tokens used (input + cache_read)
}
```

**Context Window Calculation:**
```lua
-- context_used = input_tokens + cache_read_input_tokens
-- If exceeds base window (200k), assume extended context (1M)
local base_window = config.context_windows[model] or 200000
if context_used > base_window then
    window = 1000000
end
return math.floor((context_used / window) * 100)
```

**Status Determination Logic:**
1. **pending_tool + recent** → `waiting` (permission: tool_name)
2. **active_tool + <2min** → `working` (running: tool_name)
3. **last_message=assistant + <10min** → `waiting` (awaiting input)
4. **attached + <2min** → `active`
5. **else** → `idle`

### llm.lua

**Configuration:**
```lua
local LLM_URL = "http://localhost:1234/v1/chat/completions"
local MODEL = "qwen/qwen3-30b-a3b-2507"
local CACHE_TTL = 10  -- seconds
```

**Async Pattern:**
```lua
-- Returns cached result immediately, kicks off async refresh
function M.analyze_session(jsonl_path, session_name, num_entries)
    local cached = M.cache[cache_key]
    if cached and (now - cached.time) < CACHE_TTL then
        return cached.result  -- Fresh cache
    end
    if M.pending[cache_key] then
        return cached and cached.result or nil  -- In-flight, return stale
    end
    M.pending[cache_key] = true
    M.fetch_async(jsonl_path, cache_key, num_entries)
    return cached and cached.result or nil  -- Stale or nil while fetching
end
```

**Prompt Structure:**
```
System: Analyze Claude Code session data...
Response format: {"state": "STATE", "detail": "DETAIL", "summary": "SUMMARY"}
STATE: working | permission | waiting | idle
```

**Entry Condensation:**
For LLM input, entries are condensed to essential fields:
- `type`, `timestamp`, `content` (truncated), `tool`, `tool_input`, `tool_result`

### utils.lua

**Key Utilities:**
```lua
-- Path conversion: /Users/foo/bar → -Users-foo-bar
path_to_claude_project(path)

-- ISO 8601 to Unix timestamp
parse_timestamp("2026-01-15T20:52:55.836Z") → 1736977975

-- Human-readable time
time_ago(seconds) → "now" | "2m ago" | "1h ago" | "3d ago"

-- Safe JSON decode with pcall
safe_json_decode(str) → table | nil

-- HTML escaping
escape_html(str)

-- Text utilities
truncate(str, max_length)
clean_whitespace(str)
```

### config.lua

**Key Configuration:**
```lua
{
  claude_projects_dir = "~/.claude/projects/",
  context_windows = {
    ["claude-opus-4-5-20251101"] = 200000,
    ["claude-sonnet-4-20250514"] = 1000000,
    default = 200000
  },
  terminal_app = "Code",  -- VSCode for focus
  refresh_interval = 30,  -- seconds
  panel = { width = 380, height = 900, x = 20, y = 50 }
}
```

### html.lua

**Status Colors:**
```lua
{
  active = "#4ade80",     -- green
  working = "#facc15",    -- yellow (pulsing)
  thinking = "#f97316",   -- orange (pulsing)
  waiting = "#60a5fa",    -- blue
  permission = "#f97316", -- orange
  error = "#ef4444",      -- red
  idle = "#6b7280",       -- gray
}
```

**Context Bar Colors:**
```lua
-- Based on percentage:
> 75% → red (#ef4444)
> 50% → orange (#f97316)
> 30% → yellow (#facc15)
else  → green (#4ade80)
```

## Effect-TS Translation Notes

### Service Pattern

Each module maps to an Effect Service with `Context.Tag`:

```typescript
// TmuxService.ts
class TmuxService extends Context.Tag("TmuxService")<TmuxService, {
  getSessions: () => Effect<Map<string, TmuxSession>, TmuxError>
  capturePane: (session: string, window?: string) => Effect<Option<string>, TmuxError>
  focusSession: (session: string, window?: string) => Effect<void, TmuxError>
  getGithubRepo: (path: string) => Effect<Option<string>, TmuxError>
}>() {}
```

### Error Handling

Lua uses nil returns; Effect-TS should use typed errors:

```typescript
class TmuxError extends Data.TaggedError("TmuxError")<{
  operation: string
  message: string
}> {}

class ClaudeParseError extends Data.TaggedError("ClaudeParseError")<{
  path: string
  reason: string
}> {}
```

### Command Execution

Use `@effect/platform-node` for shell commands:

```typescript
import { Command } from "@effect/platform"

const getSessions = Effect.gen(function* () {
  const output = yield* Command.make("tmux", "list-sessions", "-F", "...")
    .pipe(Command.string)
  // Parse output...
})
```

### File Operations

Use `@effect/platform` FileSystem:

```typescript
import { FileSystem } from "@effect/platform"

const parseSession = (path: string) => Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const content = yield* fs.readFileString(path)
  // Parse JSONL...
})
```

### Schema Validation

Use `@effect/schema` for JSONL entries:

```typescript
import { Schema } from "@effect/schema"

const ClaudeEntry = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("user"),
    timestamp: Schema.String,
    message: UserMessage,
  }),
  Schema.Struct({
    type: Schema.Literal("assistant"),
    timestamp: Schema.String,
    message: AssistantMessage,
  })
)
```

### Caching

Use Effect's caching with TTL:

```typescript
import { Cache, Duration } from "effect"

const analysisCache = Cache.make({
  capacity: 100,
  timeToLive: Duration.seconds(10),
  lookup: (key: string) => analyzeWithLlm(key)
})
```

### Reactive State

Use @effect-atom for reactive state in renderer:

```typescript
import { atom } from "@effect-atom/atom"

const sessionsAtom = atom<TrackedSession[]>([])
const selectedSessionAtom = atom<string | null>(null)
```

## JSONL Entry Types

**User Message:**
```json
{
  "type": "user",
  "timestamp": "2026-01-15T20:52:55.836Z",
  "message": {
    "content": "string" | [{ "type": "text", "text": "..." }, { "type": "tool_result", "tool_use_id": "..." }]
  }
}
```

**Assistant Message:**
```json
{
  "type": "assistant",
  "timestamp": "2026-01-15T20:52:55.836Z",
  "message": {
    "model": "claude-opus-4-5-20251101",
    "usage": {
      "input_tokens": 50000,
      "output_tokens": 1000,
      "cache_read_input_tokens": 100000
    },
    "content": [
      { "type": "text", "text": "..." },
      { "type": "tool_use", "id": "...", "name": "Bash", "input": { "command": "..." } }
    ]
  }
}
```

**Metadata (early in file):**
```json
{
  "slug": "session-name",
  "gitBranch": "feat/branch-name",
  "sessionId": "uuid"
}
```
