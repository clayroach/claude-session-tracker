# Product Requirements Document: Claude Session Tracker

**Version:** 1.1
**Author:** Clay
**Date:** January 15, 2026
**Status:** Hammerspoon Prototype Complete (Phase 1 & 2)  

---

## Executive Summary

A persistent, always-on-top macOS floating panel that provides real-time visibility into multiple Claude Code sessions across git worktrees, using tmux as the navigation backbone. The tool enables developers running parallel Claude Code sessions to monitor progress, context usage, and quickly switch between sessions without hunting through terminal tabs or VSCode windows.

---

## Problem Statement

### Current Pain Points

1. **Session Visibility Gap**: When running multiple Claude Code sessions across different git worktrees, there's no centralized view of what each session is doing
2. **Context Switching Friction**: Finding and focusing the right terminal/VSCode window for a specific worktree requires hunting through tabs
3. **Progress Blindness**: No way to see at-a-glance summaries of what Claude is working on in each session
4. **Context Window Anxiety**: No persistent indicator of how full each session's context window is

### User Workflow Context

```
Developer Workflow:
┌─────────────────────────────────────────────────────────────────┐
│  Main worktree (~/projects/atrim)                               │
│  └── tmux session: "atrim-main"                                 │
│      ├── window "claude" → Claude Code session (code review)    │
│      └── window "bash"   → Shell for git, tests, etc.          │
├─────────────────────────────────────────────────────────────────┤
│  Feature worktree (~/worktrees/trace-view)                      │
│  └── tmux session: "atrim-trace-view"                           │
│      ├── window "claude" → Claude Code session (implementing)   │
│      └── window "bash"   → Shell                                │
├─────────────────────────────────────────────────────────────────┤
│  Fix worktree (~/worktrees/auth-fix)                            │
│  └── tmux session: "atrim-auth-fix"                             │
│      ├── window "claude" → Claude Code session (debugging)      │
│      └── window "bash"   → Shell                                │
└─────────────────────────────────────────────────────────────────┘
```

The developer cycles between these throughout the day but loses track of:
- Which sessions are actively working vs idle
- How much context each session has consumed
- What each Claude session is currently doing
- Which session they should check next

---

## Goals & Success Metrics

### Primary Goals

1. **Instant Visibility**: See all active Claude sessions and their status at a glance
2. **One-Click Navigation**: Click a session to immediately focus that tmux session in VSCode
3. **Context Awareness**: Always know context window utilization per session
4. **Progress Summaries**: See what each session is working on without switching to it

### Success Metrics

| Metric | Target |
|--------|--------|
| Time to find correct session | < 2 seconds (from 30+ seconds) |
| Context window surprises | Zero (currently frequent) |
| Sessions lost/forgotten | Zero |
| Daily context switches saved | 20+ |

---

## Solution Overview

### Core Concept

A floating macOS panel that:
1. **Reads tmux session tree** as the source of truth for session organization
2. **Parses Claude Code session data** from `~/.claude/projects/` for status/progress
3. **Displays unified view** with worktree name, Claude status, context %, and summary
4. **Enables one-click focus** to jump directly into VSCode + tmux session

### Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  tmux (Source of Truth)                                                  │
│  ├── tmux list-sessions → Get all session names + paths                 │
│  ├── tmux list-windows  → Get windows per session (claude, bash)        │
│  └── tmux display-message → Get active/attached status                  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Claude Code Data (~/.claude/projects/)                                  │
│  ├── Match tmux session path → Claude project directory                 │
│  ├── Parse chat_*.jsonl      → Recent messages, tool usage              │
│  ├── Extract token counts    → Context window utilization               │
│  └── Generate summary        → Last N messages or AI-generated          │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Floating Panel (Always-on-Top)                                          │
│  ├── Session list with status indicators                                │
│  ├── Context bar visualization                                          │
│  ├── Progress summaries                                                 │
│  └── Click → Focus tmux session in VSCode                               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Two Implementation Approaches

### Approach A: Hammerspoon + WebView

**Architecture:**
```lua
-- Hammerspoon creates floating WebView
local webview = hs.webview.new({x=20, y=40, w=340, h=400})
webview:windowStyle({"utility", "HUD", "titled"})
webview:level(hs.drawing.windowLevels.floating)  -- Always on top
webview:html(generateSessionHTML())
webview:show()

-- Timer polls tmux + Claude data every 30 seconds
hs.timer.doEvery(30, function()
    webview:html(generateSessionHTML())
end)
```

**Visual Design (Hammerspoon):**

```
┌─────────────────────────────────────────┐
│ ⚡ Claude Sessions          Hammerspoon │
├─────────────────────────────────────────┤
│ ● atrim-trace-view      ████░░░░ 42%   │
│   Implementing ECharts timeline...      │
│                                         │
│ ○ atrim-auth-fix        ██░░░░░░ 18%   │
│   Token refresh complete - testing...   │
│                                         │
│ ◉ atrim-main            ██████░░ 67%   │
│   Code review PR #234...                │
├─────────────────────────────────────────┤
│ ⌘⇧C to toggle    Click session to focus│
└─────────────────────────────────────────┘

Legend: ● active  ◉ working  ○ idle
```

**Characteristics:**
- Monospace, terminal-aesthetic design
- Compact, utilitarian appearance
- Fast to prototype (Lua + HTML/CSS)
- WebView may have memory overhead

**Pros:**
- Quick to build (2-4 hours)
- You already have Hammerspoon experience
- HTML/CSS flexibility for styling
- Can iterate rapidly

**Cons:**
- WebView can be memory-heavy
- Less native macOS feel
- Depends on Hammerspoon running
- No menubar presence

---

### Approach B: Native Swift App

**Architecture:**
```swift
import SwiftUI
import AppKit

@main
struct ClaudeTrackerApp: App {
    var body: some Scene {
        // Menubar icon with dropdown
        MenuBarExtra("Claude", systemImage: "terminal.fill") {
            ContentView()
        }
        .menuBarExtraStyle(.window)
        
        // Detachable floating panel
        Window("Sessions", id: "sessions") {
            SessionListView()
        }
        .windowStyle(.hiddenTitleBar)
        .windowLevel(.floating)  // Always on top
    }
}
```

**Visual Design (Native Swift):**

```
┌─────────────────────────────────────────────┐
│ ● ● ●  Claude Session Monitor    3 active   │
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │ ● atrim-trace-view      ~/worktrees/... │ │
│ │   Context ████████░░░░░░░░░░░░ 42%      │ │
│ │ ┌─────────────────────────────────────┐ │ │
│ │ │ Implementing ECharts timeline       │ │ │
│ │ │ visualization for distributed...    │ │ │
│ │ └─────────────────────────────────────┘ │ │
│ │   🕐 2m ago  📊 85K  💰 $4.20           │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ ○ atrim-auth-fix        ~/worktrees/... │ │
│ │   Context ███░░░░░░░░░░░░░░░░░ 18%      │ │
│ │ ┌─────────────────────────────────────┐ │ │
│ │ │ Token refresh logic complete -      │ │ │
│ │ │ waiting for test results            │ │ │
│ │ └─────────────────────────────────────┘ │ │
│ │   🕐 12m ago  📊 23K  💰 $0.85          │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ ◉ atrim-main            ~/projects/...  │ │
│ │   Context █████████████░░░░░░░ 67%      │ │
│ │ ┌─────────────────────────────────────┐ │ │
│ │ │ Code review PR #234 - reviewing     │ │ │
│ │ │ storage layer changes               │ │ │
│ │ └─────────────────────────────────────┘ │ │
│ │   🕐 now  📊 142K  💰 $7.10             │ │
│ └─────────────────────────────────────────┘ │
├─────────────────────────────────────────────┤
│  [↗ Focus]  [🔄 Refresh]      Updated 3s ago│
└─────────────────────────────────────────────┘
```

**Characteristics:**
- Native macOS vibrancy and blur effects
- Traffic light window controls
- Menubar icon with quick access
- Detachable floating panel
- Smooth animations

**Pros:**
- True native macOS experience
- Lightweight, fast, low memory
- Can use `NSWindow.level = .floating`
- Standalone app (no dependencies)
- Menubar presence with detachable panel
- Can be notarized for distribution

**Cons:**
- More development time (1-2 days)
- Requires Xcode and Swift knowledge
- Need to sign/notarize for distribution
- Less flexible for rapid iteration

---

## Comparison Matrix

| Aspect | Hammerspoon | Native Swift |
|--------|-------------|--------------|
| **Development Time** | 2-4 hours | 1-2 days |
| **Memory Usage** | Higher (WebView) | Lower (native) |
| **Native Feel** | Good | Excellent |
| **Menubar Integration** | Manual | Built-in |
| **Dependencies** | Hammerspoon required | Standalone |
| **Distribution** | Copy Lua files | Notarized .app |
| **Iteration Speed** | Fast | Slower |
| **Always-on-Top** | ✓ (webview level) | ✓ (window level) |
| **Click-to-Focus** | ✓ (hs.execute) | ✓ (NSWorkspace) |

---

## Functional Requirements

### FR-1: Session Discovery

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | Parse tmux sessions matching configured prefix | P0 |
| FR-1.2 | Identify "claude" and "bash" windows per session | P0 |
| FR-1.3 | Detect session attached/detached status | P1 |
| FR-1.4 | Map tmux session path to git worktree | P1 |

### FR-2: Claude Data Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | Parse `~/.claude/projects/*/chat_*.jsonl` files | P0 |
| FR-2.2 | Calculate context window utilization (%) | P0 |
| FR-2.3 | Extract last N messages for summary | P0 |
| FR-2.4 | Detect active tool usage (reading, writing, etc.) | P1 |
| FR-2.5 | Calculate estimated cost from token counts | P2 |

### FR-3: Panel Display

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | Show session list with worktree names | P0 |
| FR-3.2 | Display status indicator (active/working/idle) | P0 |
| FR-3.3 | Show context bar with percentage | P0 |
| FR-3.4 | Display progress summary per session | P0 |
| FR-3.5 | Auto-refresh every 30 seconds | P1 |
| FR-3.6 | Manual refresh button | P1 |

### FR-4: Navigation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | Click session → Focus configured terminal app | P0 |
| FR-4.2 | Click session → Switch to that tmux session | P0 |
| FR-4.3 | Click window indicator → Switch to specific window | P1 |
| FR-4.4 | Keyboard shortcut to toggle panel visibility | P1 |

### FR-5: Configuration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | Configurable terminal app (VSCode, iTerm2, etc.) | P0 |
| FR-5.2 | Configurable tmux session prefix | P1 |
| FR-5.3 | Configurable panel position | P1 |
| FR-5.4 | Configurable update interval | P2 |

---

## Technical Specifications

### tmux Integration

```bash
# Get all sessions with paths
tmux list-sessions -F '#{session_name}:#{session_path}:#{session_attached}'

# Get windows for a session
tmux list-windows -t "session-name" -F '#{window_index}:#{window_name}:#{pane_current_path}'

# Switch to session + window
tmux switch-client -t "session-name:window-name"

# Send keys to focus (for VSCode integration)
tmux select-window -t "session-name:claude"
```

### Claude Session Data Format

Location: `~/.claude/projects/<project-hash>/`

```
~/.claude/projects/
├── abc123-def456/           # Project hash
│   ├── chat_2026-01-15.jsonl   # Session transcript
│   └── .current              # Active session marker
└── ghi789-jkl012/
    └── chat_2026-01-14.jsonl
```

JSONL format (each line):
```json
{
  "type": "user" | "assistant" | "tool_use" | "tool_result",
  "content": "...",
  "timestamp": "2026-01-15T10:30:00Z",
  "model": "claude-opus-4-5-20251101",
  "usage": {
    "input_tokens": 45000,
    "output_tokens": 2000,
    "cache_read_tokens": 10000
  }
}
```

### VSCode Focus Integration

```bash
# Option 1: Use VSCode CLI to open folder
code --goto ~/worktrees/trace-view

# Option 2: AppleScript to focus VSCode window
osascript -e 'tell application "Visual Studio Code" to activate'

# Option 3: Hammerspoon app focus
hs.application.launchOrFocus("Code")
```

### tmux Session Naming Convention

```
<project>-<worktree>
```

Examples:
- `atrim-main` → Main branch in ~/projects/atrim
- `atrim-trace-view` → Feature branch in ~/worktrees/trace-view
- `atrim-auth-fix` → Fix branch in ~/worktrees/auth-fix

---

## User Experience Flow

### Flow 1: Passive Monitoring

```
1. Developer works normally
2. Floating panel visible in corner (always on top)
3. Glance at panel to see:
   - Which sessions are active
   - Context utilization per session
   - What each is working on
4. Notice "atrim-trace-view" is at 80% context
5. Decide to wrap up that session soon
```

### Flow 2: Active Navigation

```
1. Developer needs to check auth-fix progress
2. Look at floating panel
3. Click "atrim-auth-fix" session
4. VSCode focuses with that tmux session attached
5. See Claude's work immediately
```

### Flow 3: Context Alert

```
1. Panel shows "atrim-main" at 90% context (red)
2. Developer clicks to focus
3. Asks Claude to summarize and end session
4. Starts fresh session if needed
```

---

## Implementation Plan

### Phase 1: Hammerspoon Prototype (COMPLETE)

- [x] Create basic Lua script reading tmux sessions
- [x] Parse Claude session data (last messages, tokens)
- [x] Build HTML template for WebView panel
- [x] Implement click-to-focus with tmux switch
- [x] Add keyboard shortcut toggle (Cmd+Shift+C)
- [x] Test with real workflow

### Phase 2: Refinement (COMPLETE)

- [x] Add context percentage calculation
- [x] Implement status detection (active/working/waiting/idle)
- [x] Add progress summary generation
- [x] Polish visual design (path, branch, wrapped summaries)
- [x] Add configuration options
- [x] Handle edge cases (no sessions, disconnected, etc.)

### Phase 3: Native Swift (Optional)

- [ ] Create Xcode project with MenuBarExtra
- [ ] Implement session data layer (shared with prototype)
- [ ] Build SwiftUI views
- [ ] Add floating window support
- [ ] Sign and notarize
- [ ] Package for distribution

---

## Implementation Notes

Key technical decisions and fixes made during Phase 1 & 2 implementation:

### Path Mapping
- tmux path `/Users/croach/projects/foo` maps to Claude project dir `-Users-croach-projects-foo`
- Simple transformation: `path:gsub("/", "-")` (leading `/` becomes `-`)

### Context Window Calculation
- Uses `current_context = input_tokens + cache_read_input_tokens` from the **last** assistant message
- Not cumulative - represents current context window usage for that conversation turn
- Percentage calculated against 200K default context window

### Status Detection
Four states implemented:
- `working` (yellow, pulsing) - active `tool_use` in assistant message content
- `waiting` (blue) - last message from assistant, activity < 5 minutes
- `active` (green) - attached tmux session, activity < 2 minutes
- `idle` (gray) - all other cases

### Hammerspoon Specifics
- Required full path `/opt/homebrew/bin/tmux` due to Hammerspoon's limited PATH
- Used `navigationCallback` instead of non-existent `urlCallback` for WebView URL handling
- Used `|||` separator in tmux format string (tab character `\t` not interpreted correctly)

### Files Created
```
~/.hammerspoon/
├── init.lua                    # Entry point
└── claude-tracker/
    ├── init.lua               # Module orchestration
    ├── config.lua             # Configuration
    ├── tmux.lua               # tmux session discovery
    ├── claude.lua             # JSONL parsing
    ├── panel.lua              # WebView panel
    ├── html.lua               # HTML/CSS templates
    └── utils.lua              # Utilities
```

---

## Open Questions (Resolved)

1. **Summary Generation**: ~~Use AI (Claude API call) or heuristic (last N messages)?~~
   - **Resolved**: Heuristic - last user message, truncated to 150 characters

2. **Session Matching**: ~~How to reliably match tmux path to Claude project hash?~~
   - **Resolved**: Path transformation - replace `/` with `-` (e.g., `/Users/foo` -> `-Users-foo`)

3. **Multi-Monitor**: ~~Which screen should panel appear on?~~
   - **Resolved**: Panel appears at configured x,y position (default: x=20, y=50)

4. **VSCode Workspace**: ~~Should clicking open the worktree folder in VSCode too?~~
   - **Resolved**: Currently focuses VSCode and switches tmux session; folder opening deferred to Phase 3

---

## Appendix A: Existing Tools Evaluated

| Tool | What It Does | Why Not Sufficient |
|------|--------------|-------------------|
| Claude HUD | In-terminal statusline | Only shows 1 session |
| Claude Session Manager | Web dashboard | Browser tab, hides |
| ccusage | CLI token analysis | Not real-time, not visual |
| Claude Analytics API | Org reporting | Not per-session, delayed |

---

## Appendix B: Related Files

- **Visual Mockup**: `claude-tracker-mockup.jsx` (React component with both designs)
- **Hammerspoon Skeleton**: `claude-tmux-tracker/init.lua`
- **tmux Config Reference**: VSCode terminal profile integration

---

## Appendix C: Reference Screenshots

### Hammerspoon Approach
```
┌─────────────────────────────────────────┐
│ ⚡ Claude Sessions          Hammerspoon │
├─────────────────────────────────────────┤
│                                         │
│ ● atrim-trace-view      ████░░░░ 42%   │
│   Implementing ECharts timeline...      │
│                                         │
│ ○ atrim-auth-fix        ██░░░░░░ 18%   │
│   Token refresh complete - testing...   │
│                                         │
│ ◉ atrim-main            ██████░░ 67%   │
│   Code review PR #234...                │
│                                         │
├─────────────────────────────────────────┤
│ ⌘⇧C to toggle    Click session to focus│
└─────────────────────────────────────────┘

Design: Monospace font, dark terminal aesthetic
- Compact and utilitarian
- Status indicators: ● active  ◉ working  ○ idle
- Inline context bars
- Single-line summaries
```

### Native Swift Approach
```
┌─────────────────────────────────────────────┐
│ ● ● ●  Claude Session Monitor    3 active   │
├─────────────────────────────────────────────┤
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ ● atrim-trace-view                 Opus │ │
│ │   ~/worktrees/trace                     │ │
│ │   Context ████████░░░░░░░░░░ 42%        │ │
│ │ ┌─────────────────────────────────────┐ │ │
│ │ │ Implementing ECharts timeline       │ │ │
│ │ │ visualization for distributed...    │ │ │
│ │ └─────────────────────────────────────┘ │ │
│ │   🕐 2m ago  📊 85K  💰 $4.20           │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ ○ atrim-auth-fix                 Sonnet │ │
│ │   ~/worktrees/auth                      │ │
│ │   Context ███░░░░░░░░░░░░░░░░░ 18%      │ │
│ │ ┌─────────────────────────────────────┐ │ │
│ │ │ Token refresh logic complete -      │ │ │
│ │ │ waiting for test results            │ │ │
│ │ └─────────────────────────────────────┘ │ │
│ │   🕐 12m ago  📊 23K  💰 $0.85          │ │
│ └─────────────────────────────────────────┘ │
│                                             │
├─────────────────────────────────────────────┤
│  [↗ Focus]  [🔄 Refresh]      Updated 3s ago│
└─────────────────────────────────────────────┘

Design: Native macOS with vibrancy
- Traffic light window controls
- Card-based session layout
- Gradient context bars with color coding
- Rich metadata (time, tokens, cost)
- Hover states and smooth animations
```

---

*Document generated for Atrim.ai development workflow optimization*
