# Claude Session Tracker - Development Session Summary

**Date:** January 15, 2026
**Status:** Multiple Claude sessions per tmux implemented, needs testing
**Last Modified:** Session being summarized for handoff

---

## Current State

### What's Working
- ✅ Hammerspoon panel displays tmux sessions matching pattern `^atrim`
- ✅ Parses Claude JSONL files from `~/.claude/projects/`
- ✅ Shows context %, model, status indicators
- ✅ Keyboard toggle: `Cmd+Shift+C`
- ✅ Click session → Opens VSCode at that path (VS button)
- ✅ Multiple Claude sessions per tmux session (up to 3, within 12 hours)
- ✅ Status detection via tmux pane content parsing
- ✅ Deduplication by Claude session ID

### Known Issues
1. **VSCode opening** - May not work reliably, needs testing
2. **tmux session switching** - Commented out (wasn't working), only VSCode focus works
3. **Status detection accuracy** - Terminal parsing patterns may need refinement
4. **Session ordering** - Old sessions with stale tool_use might sort incorrectly
5. **Project name display** - Shows last directory name, but multiple tmux sessions can share same path

### Not Yet Implemented
- Native Swift app (Phase 3 - optional)
- Path validation (filter out non-existent directories) - was added then removed
- Window-specific Claude session mapping within tmux

---

## Architecture

### File Structure
```
~/.hammerspoon/
├── init.lua                    # Entry point, requires claude-tracker
└── claude-tracker/
    ├── init.lua               # Main orchestration, gather_sessions()
    ├── config.lua             # Configuration (pattern, paths, hotkey)
    ├── tmux.lua               # tmux integration + pane content parsing
    ├── claude.lua             # JSONL parsing, find_all_sessions()
    ├── panel.lua              # WebView panel, JavaScript callbacks
    ├── html.lua               # HTML/CSS templates
    └── utils.lua              # Utilities (path mapping, time_ago)
```

### Key Functions

**init.lua**
- `gather_sessions()` - Main data pipeline, returns sorted sessions array
- `build_session_data_with_claude()` - Builds session object with tmux pane state detection
- `build_session_data_without_claude()` - Placeholder for sessions without Claude data

**tmux.lua**
- `get_sessions()` - Returns map of session_name → {path, attached}
- `capture_pane(session_name, window_name)` - Captures last 50 lines of tmux pane
- `detect_pane_state(pane_content)` - Parses terminal content for state detection

**claude.lua**
- `find_all_sessions(project_dir, max=5, max_age_hours=24)` - Finds multiple JSONL files per project
- `parse_session(jsonl_path)` - Parses JSONL, tracks pending tools
- `determine_status()` - Fallback status detection from JSONL (pane detection preferred)

**panel.lua**
- `create()` - Creates WebView with `usercontent` for JavaScript callbacks
- `open_in_vscode(session_name)` - Uses `/usr/local/bin/code` to open path

---

## Data Flow

```
tmux sessions
    ↓
for each session:
    find ALL recent Claude sessions (up to 3, 12hrs old)
    ↓
    for each Claude session:
        1. Parse JSONL (tokens, model, summary)
        2. Capture tmux pane content
        3. Detect state from pane (permission/working/waiting/error)
        4. Build session object with unique ID
    ↓
    deduplicate by session_id across all tmux sessions
    ↓
sort by: status priority → timestamp
    ↓
render in WebView panel
```

---

## Key Decisions & Technical Details

### 1. Path Mapping
- tmux path: `/Users/croach/projects/atrim`
- Claude project dir: `-Users-croach-projects-atrim`
- Transformation: `path:gsub("/", "-")`

### 2. Multiple Sessions Per Tmux
- Each tmux session path → multiple Claude JSONL files
- Display with index suffix: `session-name`, `session-name-2`, `session-name-3`
- Deduplicated by `session_id` field from JSONL to prevent duplicates across tmux sessions

### 3. Status Detection (Two-Pass)
**Primary:** Terminal pane content parsing (tmux capture-pane)
- `permission` - "Do you want to proceed?", Yes/No prompts
- `working` - "Running...", processing indicators
- `waiting` - PR created, awaiting input prompts
- `error` - Error messages
- `idle` - Default

**Fallback:** JSONL parsing
- Checks for pending `tool_use` blocks without `tool_result`
- Last message role (assistant vs user)
- Activity timestamp recency

### 4. Hammerspoon WebView with JavaScript
- Uses `hs.webview.usercontent.new("hammerspoon")` for JS callbacks
- JavaScript: `webkit.messageHandlers.hammerspoon.postMessage({action, session})`
- Handles: `focus` (tmux switch - disabled), `open` (VSCode), `refresh`

### 5. Context Window Calculation
- Uses `current_context = input_tokens + cache_read_input_tokens` from **last** assistant message
- Not cumulative - represents current turn's context usage
- Default window: 200K tokens

---

## Terminal State Detection Patterns

**Permission prompts:**
```lua
recent:match("Do you want to proceed%?")
recent:match("Bash command") or recent:match("Bash%(")
→ "approve: bash: [command]"
```

**Working/Running:**
```lua
recent:match("Running") or recent:match("⏳")
→ "running: [tool]"
```

**Completion states:**
```lua
recent:match("PR created:") → "PR created"
recent:match("commit%s+%x+") → "committed"
```

**Awaiting input:**
```lua
recent:match("❯") or recent:match(">%s*$")
→ "awaiting input"
```

---

## Configuration

**Location:** `~/.hammerspoon/claude-tracker/config.lua`

```lua
M.config = {
    tmux_session_pattern = "^atrim",
    claude_projects_dir = os.getenv("HOME") .. "/.claude/projects/",
    context_windows = { default = 200000 },
    terminal_app = "Code",  -- For launchOrFocus (should be "Visual Studio Code")
    panel = { width = 380, height = 900, x = 20, y = 50 },
    refresh_interval = 30,
    hotkey = {"cmd", "shift"},
    hotkey_key = "C",
}
```

---

## Recent Changes (This Session)

1. **Added multiple Claude sessions per tmux** - `find_all_sessions()` returns array
2. **Added tmux pane content parsing** - `capture_pane()` + `detect_pane_state()`
3. **Changed display name** - Now shows last directory name (project) instead of tmux-derived name
4. **Added status_detail** - Shows specific waiting state (e.g., "approve: bash: git push")
5. **Fixed status detection** - Terminal content takes precedence over JSONL parsing
6. **Added session deduplication** - Tracks seen session IDs to avoid duplicates
7. **Added permission status color** - Orange for permission requests, red for errors

---

## Next Steps / TODO

### High Priority
1. **Test the changes** - Restart Hammerspoon, verify:
   - Multiple sessions appear correctly
   - Status detection is accurate (permission prompts, running, waiting)
   - VS button opens correct VSCode window
   - No duplicate sessions shown

2. **Refine terminal patterns** - May need to add more patterns based on actual Claude Code output:
   - More tool types (Edit, Write, Read, etc.)
   - Better command extraction from Bash prompts
   - Handle multi-line prompts

3. **Fix VSCode opening** - Currently uses base tmux session name, needs to map back to original

### Medium Priority
4. **Add window identification** - Map Claude sessions to specific tmux windows (not just session)
5. **Improve sorting** - Consider both activity time AND status for better ordering
6. **Add visual indicator** for multiple sessions from same tmux session
7. **Performance** - Capturing pane content for every session may be slow, consider caching

### Low Priority
8. **Add LLM summarization** - Send last N messages to Claude API for better summaries
9. **Add filtering/search** - Too many sessions? Add ability to filter by status/project
10. **Native Swift app** - Phase 3 (optional)

---

## How to Resume

1. **Read this document** to understand current state
2. **Test current implementation:**
   ```bash
   # Restart Hammerspoon
   # Press Cmd+Shift+C to toggle panel
   # Check console for debug output
   ```

3. **Check console for errors:**
   - Look for `[claude-tracker]` log lines
   - Verify pane capture is working
   - Check if sessions appear correctly

4. **Common issues to debug:**
   - Session deduplication not working? Check `seen_claude_sessions` logic
   - Wrong status? Add debug output to `detect_pane_state()`
   - VS button not working? Check `open_in_vscode()` path lookup

5. **Files to modify:**
   - `tmux.lua` - Terminal state detection patterns
   - `init.lua` - Session building and sorting logic
   - `html.lua` - Display formatting

---

## Research Notes

- No existing Lua libraries parse Claude Code terminal state
- Claude Code statusline JSON has metrics but no state field
- Agent SDK has `canUseTool` callback but requires running Claude through SDK
- Terminal parsing is the most practical approach for monitoring existing sessions

## Related Files

- **PRD:** `/Users/croach/projects/claude-session-tracker/claude-session-tracker-prd.md`
- **Progress:** `/Users/croach/projects/claude-session-tracker/tmp/2026-01-15/claude-session-tracker-prd.progress.txt`
- **This summary:** `/Users/croach/projects/claude-session-tracker/SESSION-SUMMARY.md`

---

## Questions for Next Session

1. Should we filter out non-existent paths, or keep them visible?
2. How to handle >3 Claude sessions per tmux? (currently limited to 3)
3. Should clicking VS button also switch tmux window?
4. Is 12-hour age limit appropriate for session discovery?
5. Should we add session age visualization (e.g., fade old sessions)?
