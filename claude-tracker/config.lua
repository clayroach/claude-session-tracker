-- config.lua
-- Configuration for Claude Session Tracker

local M = {}

M.config = {
    -- tmux session prefix pattern (Lua pattern)
    -- Match all sessions - filtering happens based on Claude JSONL presence
    tmux_session_pattern = ".",

    -- Claude projects directory
    claude_projects_dir = os.getenv("HOME") .. "/.claude/projects/",

    -- Captured permission prompts file
    capture_file = os.getenv("HOME") .. "/.claude/captured-prompts.jsonl",

    -- Context window sizes by model (in tokens)
    -- Set to 1000000 if you typically use extended context mode ([1m])
    context_windows = {
        ["claude-opus-4-5-20251101"] = 200000,
        ["claude-sonnet-4-20250514"] = 1000000,   -- Assume extended context for Sonnet
        ["claude-sonnet-4-5-20250514"] = 1000000,
        ["claude-sonnet-4-5-20250929"] = 1000000,
        -- Default fallback
        default = 200000
    },

    -- Terminal/editor app for focus (when clicking a session)
    terminal_app = "Code",  -- VSCode; could be "iTerm2", "Terminal", "Warp"

    -- Panel settings
    panel = {
        width = 380,
        height = 900,  -- Taller to show more sessions
        x = 20,        -- Distance from left edge
        y = 50,        -- Distance from top edge
    },

    -- Refresh interval in seconds
    refresh_interval = 30,

    -- Number of recent messages to consider for summary
    summary_message_count = 5,

    -- Hotkey modifier keys
    hotkey = {"cmd", "shift"},
    -- Hotkey key
    hotkey_key = "C",
}

return M
