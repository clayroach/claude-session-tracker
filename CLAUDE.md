# Claude Session Tracker

## Project Overview

A proof-of-concept Hammerspoon tool for monitoring Claude Code sessions in tmux. This is a POC - keep changes minimal and focused.

## Tech Stack

- **Lua** - Hammerspoon's scripting language
- **Hammerspoon** - macOS automation framework
- **WebView** - For the floating panel UI (HTML/CSS/JS)

## Project Structure

```
claude-tracker/     # Lua modules (symlinked to ~/.hammerspoon/claude-tracker/)
├── init.lua        # Entry point, session orchestration
├── config.lua      # Configuration values
├── tmux.lua        # tmux session/pane interaction
├── claude.lua      # Claude JSONL file parsing
├── panel.lua       # WebView panel management
├── html.lua        # HTML/CSS templates
└── utils.lua       # Shared utilities
```

## Development Notes

- The `claude-tracker/` directory is symlinked from `~/.hammerspoon/claude-tracker/`
- After changes, reload Hammerspoon config to test (`Cmd+Shift+C` toggles panel)
- Session data is read from `~/.claude/projects/*/sessions/` JSONL files
- tmux sessions matching pattern `^atrim` are monitored by default
