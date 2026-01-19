# Claude Session Tracker

## Project Overview

A desktop application for monitoring Claude Code sessions in tmux. Built with Electron + Effect-TS, this is a complete rewrite of the original Hammerspoon/Lua POC.

## Tech Stack

- **Electron** - Cross-platform desktop app framework
- **Effect-TS** - Functional effect system for type-safe async/error handling
- **React** - UI rendering
- **TypeScript** - Type safety throughout
- **Tailwind CSS** - Styling

## Project Structure

```
src/
├── main/
│   ├── index.ts                    # Main process, IPC handlers, window management
│   └── services/
│       ├── ClaudeService.ts        # JSONL parsing, session data extraction
│       ├── TmuxService.ts          # tmux interaction via commands
│       ├── SessionService.ts       # Session orchestration, deduplication
│       ├── LlmService.ts           # Optional LLM integration for summaries
│       └── SettingsStore.ts        # Settings persistence with schemas
├── preload/
│   └── index.ts                    # IPC bridge with type-safe API
├── renderer/
│   ├── App.tsx                     # Main UI, state management
│   └── components/
│       ├── SessionRow.tsx          # Session cards (regular/compact)
│       ├── StatusIndicator.tsx     # Animated status dots
│       ├── ContextBar.tsx          # Token usage visualization
│       ├── ClaudeLogo.tsx          # Official Claude AI logo
│       └── Settings.tsx            # Settings modal
├── claude-tracker/                 # Original Lua implementation (reference)
└── tmp/2026-01-18/                 # PRD and progress tracking
```

## Development

```bash
pnpm install          # Install dependencies
pnpm dev              # Start dev server (hot reload)
pnpm build            # Build for production
pnpm typecheck        # TypeScript type checking
pnpm lint             # ESLint
pnpm test             # Run tests
```

## Architecture

### Effect-TS Services
- **ClaudeService** - Parses JSONL session files with Schema validation
- **TmuxService** - Executes tmux commands via @effect/platform Command
- **SessionService** - Orchestrates discovery, deduplication, sorting
- **LlmService** - Optional local LLM analysis (LM Studio, Ollama, Claude API)
- **SettingsStore** - Persistent settings with validation

### IPC Communication
- Main → Renderer: `sessions-update`, `settings-update`
- Renderer → Main: `get-sessions`, `refresh`, `focus-session`, `open-editor`, `save-settings`, `test-llm-connection`, `set-window-opacity`

### Key Features
- Session deduplication (one per Claude project)
- Multi-layer status detection (LLM → pane content → JSONL patterns)
- Window position persistence
- LRU history tracking
- Hide/show sessions
- Weekly usage tracking with smart color-coding
- Transparency control

## Performance Notes

- Polling interval: 60s (configurable)
- LLM cache: 5 minutes with mtime-based keys
- Only analyze sessions < 10min old
- Only re-analyze when JSONL files change
- Parallel session processing (5 concurrent)

## Settings Location

`~/Library/Application Support/claude-session-tracker/settings.json`

## Issues & Future Work

See GitHub issues for planned enhancements:
- Issue #1: Fetch usage limits from Anthropic API
- Issue #2: Optimize with tmux-first parsing
