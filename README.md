# Claude Session Tracker

A desktop app for monitoring your Claude Code sessions in tmux. Get instant visibility into session status, token usage, and activity across all your projects.

![Screenshot](screenshot.png)

## Features

- **Real-time Session Monitoring** - See all your Claude Code sessions at a glance
- **Smart Status Detection** - Know when Claude is working, waiting, or needs permission
- **Token Usage Tracking** - Visual context window utilization with color-coded warnings
- **Weekly Usage Display** - Track your Claude usage with smart color-coding (green/yellow/orange/red)
- **LRU History** - Quick access to recently used sessions
- **Floating Panel** - Always-on-top window with transparency control
- **Quick Actions** - Click to open in editor, double-click to focus terminal
- **Compact & Regular Views** - Maximize information density or detail
- **Window Position Persistence** - Remembers your preferred location

## Installation

### Prerequisites

- macOS (currently)
- Node.js 18+ or Bun
- tmux
- Claude Code CLI

### Install

```bash
# Clone the repository
git clone https://github.com/clayroach/claude-session-tracker.git
cd claude-session-tracker

# Install dependencies
pnpm install
# or: bun install

# Run in development mode
pnpm dev

# Or build for production
pnpm build
```

### Running

**Development:**
```bash
pnpm dev
```

**Production:**
```bash
pnpm build
# Then run the built app from out/ directory
```

## Usage

### Keyboard Shortcuts

- `⌘⇧C` - Toggle panel visibility

### Interactions

- **Single click** - Open session in editor (code, cursor, zed, etc.)
- **Double click** - Focus tmux session (activates terminal)
- **Hover** - Show hide button

### Footer Controls

- **Left:** Transparency slider (30-100%)
- **Center:** Keyboard shortcut hint
- **Right:** Weekly usage % with smart color-coding
  - Green: On track (within ±5% of expected)
  - Yellow: Slightly over (5-15% ahead)
  - Orange: Over budget (15-25% ahead)
  - Red: Way over budget (>25% ahead)

### Settings

Click the gear icon to configure:

**LLM Integration** (optional)
- Provider: Claude, OpenAI, Ollama, LM Studio, or None
- Model selection
- Test connection button

**Session Matching**
- Regex pattern for tmux sessions (default: `.*`)
- Max session age (default: 48 hours)

**Display**
- Card size: Regular or Compact
- Sort by: Recent, Status, Name, or Context
- Window transparency

**Weekly Usage Tracking**
- Enter your current usage % from claude.ai
- Configure reset day/time
- Displays in footer with smart color-coding

**Editor**
- Command to open sessions (code, cursor, zed, nvim)

## Configuration

Settings are stored in:
```
~/Library/Application Support/claude-session-tracker/settings.json
```

## How It Works

1. Scans tmux sessions matching your pattern
2. Maps sessions to Claude project directories (`~/.claude/projects/`)
3. Parses JSONL session files for status, tokens, messages
4. Detects session status via:
   - LLM analysis (if enabled)
   - tmux pane content parsing
   - JSONL pattern analysis
5. Deduplicates (one session per project)
6. Displays in floating panel with real-time updates

## Development

See [CLAUDE.md](CLAUDE.md) for architecture details and development notes.

## Troubleshooting

**High CPU usage?**
- Disable LLM integration in Settings (set provider to "None")
- See Issue #2 for upcoming tmux-based parsing optimization

**Sessions not appearing?**
- Check session pattern in Settings (default: `.*`)
- Verify sessions are < 48 hours old
- Check tmux session working directory matches Claude projects

**Window not responding?**
- Press `⌘⇧C` to toggle
- Restart the app

## Roadmap

See GitHub Issues for planned features:
- #1: Fetch usage limits from Anthropic API
- #2: Optimize with tmux pane parsing (reduce CPU)
- Multi-session support per project
- Notifications on status changes
- Session search/filter

## License

MIT
