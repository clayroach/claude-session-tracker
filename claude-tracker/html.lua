-- html.lua
-- HTML/CSS template generation for Claude Session Tracker panel

local M = {}
local utils = require("claude-tracker.utils")

-- Status indicator colors
local STATUS_COLORS = {
    active = "#4ade80",    -- green
    working = "#facc15",   -- yellow (pulsing)
    thinking = "#f97316",  -- orange (pulsing) - Claude is thinking/processing
    waiting = "#60a5fa",   -- blue - waiting for user input
    permission = "#f97316", -- orange - waiting for permission approval
    error = "#ef4444",     -- red - error occurred
    idle = "#6b7280",      -- gray
}

--- Get context bar color based on percentage
-- @param percent number Context utilization percentage
-- @return string CSS color
local function context_color(percent)
    if percent > 75 then
        return "#ef4444"    -- red - critical
    elseif percent > 50 then
        return "#f97316"    -- orange - warning
    elseif percent > 30 then
        return "#facc15"    -- yellow - caution
    else
        return "#4ade80"    -- green - healthy
    end
end

--- Get short model name from full model ID
-- @param model string|nil Full model name like "claude-opus-4-5-20251101"
-- @return string Short name like "Opus" or "Sonnet"
local function short_model_name(model)
    if not model then return "?" end

    if model:match("opus") then
        return "Opus"
    elseif model:match("sonnet") then
        return "Sonnet"
    elseif model:match("haiku") then
        return "Haiku"
    else
        return "?"
    end
end

--- Get directory name from path
-- @param path string The filesystem path
-- @return string Directory name
local function get_dir_name(path)
    if not path then return "unknown" end
    return path:match("([^/]+)$") or "unknown"
end

--- Generate HTML for a single session row
-- @param session table Session data object
-- @return string HTML for the session row
function M.session_row(session)
    local status_color = STATUS_COLORS[session.status] or STATUS_COLORS.idle
    -- Pulse animation for working and thinking states
    local should_pulse = session.status == "working" or session.status == "thinking"
    local status_class = should_pulse and "status-dot status-working" or "status-dot"
    local bar_color = context_color(session.context_percent)
    local model_short = short_model_name(session.model)

    -- Model badge color
    local model_bg = session.model and session.model:match("opus")
        and "rgba(251,146,60,0.2)"
        or "rgba(96,165,250,0.2)"
    local model_color = session.model and session.model:match("opus")
        and "#fdba74"
        or "#93c5fd"

    -- Get repo name (prefer GitHub, fall back to directory)
    local repo_name = session.github_repo or get_dir_name(session.tmux_path)
    repo_name = utils.escape_html(repo_name)

    -- Get directory name
    local dir_name = utils.escape_html(get_dir_name(session.tmux_path))

    -- Escape display values for HTML
    local summary = utils.escape_html(session.summary or "")
    local last_activity = utils.escape_html(session.last_activity or "")
    local status_detail = session.status_detail and utils.escape_html(session.status_detail) or nil

    -- Git branch
    local branch = utils.escape_html(session.git_branch or "")

    -- Build context line: branch · directory (if different from repo)
    local context_parts = {}
    if branch ~= "" then
        table.insert(context_parts, branch)
    end
    -- Show directory if it differs from repo name (e.g., worktree directory)
    if dir_name ~= repo_name and dir_name ~= "" then
        table.insert(context_parts, dir_name)
    end
    local context_line = table.concat(context_parts, " &middot; ")

    -- URL-encode session name for the click handler
    local encoded_session = session.tmux_session:gsub(" ", "%%20"):gsub(":", "%%3A")

    -- Format meta line with status detail if available
    local meta_text = last_activity
    local meta_class = "meta"
    if status_detail then
        meta_text = status_detail
        meta_class = "meta status-detail"
    end

    return string.format([[
    <div class="session" onclick="sendMessage('focus', '%s')">
        <div class="session-row">
            <div class="%s" style="background: %s;"></div>
            <span class="repo-name">%s</span>
            <span class="vscode-btn" onclick="event.stopPropagation(); sendMessage('open', '%s')" title="Open in VSCode">VS</span>
        </div>
        <div class="branch-info">%s</div>
        <div class="summary">%s</div>
        <div class="%s">%s</div>
        <div class="context-row">
            <div class="context-bar-container">
                <div class="context-bar" style="width: %d%%; background: %s;"></div>
            </div>
            <span class="context-percent">%d%%</span>
            <span class="model-badge" style="background: %s; color: %s;">%s</span>
        </div>
    </div>
    ]],
        encoded_session,
        status_class,
        status_color,
        repo_name,
        encoded_session,
        context_line,
        summary,
        meta_class,
        meta_text,
        session.context_percent,
        bar_color,
        session.context_percent,
        model_bg,
        model_color,
        model_short
    )
end

--- Generate empty state HTML when no sessions are found
-- @return string HTML for empty state
function M.empty_state_html()
    return [[
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'SF Mono', Monaco, Menlo, monospace;
            background: rgba(30, 30, 30, 0.95);
            color: #888;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            text-align: center;
        }
        .empty {
            padding: 40px;
        }
        .empty-icon { font-size: 32px; margin-bottom: 12px; opacity: 0.6; }
        .empty-text { font-size: 12px; line-height: 1.6; }
        .empty-hint { font-size: 10px; color: #666; margin-top: 12px; }
    </style>
</head>
<body>
    <div class="empty">
        <div class="empty-icon">&#128269;</div>
        <div class="empty-text">
            No matching tmux sessions found.
        </div>
        <div class="empty-hint">
            Start a session with: claude-tmux<br>
            Pattern: ^atrim
        </div>
    </div>
</body>
</html>
    ]]
end

--- Generate full HTML document for the panel
-- @param sessions table Array of session data objects
-- @param config table Configuration object
-- @return string Complete HTML document
function M.generate_html(sessions, config)
    if not sessions or #sessions == 0 then
        return M.empty_state_html()
    end

    -- Generate session rows
    local rows = {}
    for _, session in ipairs(sessions) do
        table.insert(rows, M.session_row(session))
    end

    -- Count active sessions
    local active_count = 0
    for _, session in ipairs(sessions) do
        if session.status == "active" or session.status == "working" or session.status == "thinking" then
            active_count = active_count + 1
        end
    end

    return string.format([[
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'SF Mono', Monaco, Menlo, monospace;
            font-size: 11px;
            color: #e0e0e0;
            background: rgba(30, 30, 30, 0.95);
            -webkit-user-select: none;
            cursor: default;
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            background: rgba(255,255,255,0.05);
            border-bottom: 1px solid rgba(255,255,255,0.08);
            flex-shrink: 0;
        }
        .header-title {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .header-title .icon { font-size: 14px; }
        .header-title .text {
            font-weight: 600;
            letter-spacing: 0.3px;
        }
        .header-badge {
            padding: 3px 8px;
            background: rgba(99, 102, 241, 0.2);
            border-radius: 6px;
            font-size: 10px;
            color: #a5b4fc;
            font-weight: 500;
        }
        .sessions {
            flex: 1;
            overflow-y: auto;
        }
        .sessions::-webkit-scrollbar {
            width: 6px;
        }
        .sessions::-webkit-scrollbar-track {
            background: transparent;
        }
        .sessions::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.1);
            border-radius: 3px;
        }
        .session {
            padding: 10px 14px;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            cursor: pointer;
            transition: background 0.15s;
        }
        .session:hover {
            background: rgba(255,255,255,0.05);
        }
        .session:last-child {
            border-bottom: none;
        }
        .session-row {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%%;
            flex-shrink: 0;
        }
        .status-working {
            animation: pulse 1.5s ease-in-out infinite;
            box-shadow: 0 0 8px currentColor;
        }
        @keyframes pulse {
            0%%, 100%% { opacity: 1; transform: scale(1); }
            50%% { opacity: 0.6; transform: scale(0.9); }
        }
        .repo-name {
            color: #4ecdc4;
            font-weight: 700;
            font-size: 14px;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .branch-info {
            margin-top: 2px;
            margin-left: 16px;
            color: #a78bfa;
            font-size: 11px;
            font-weight: 500;
        }
        .model-badge {
            font-size: 9px;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 4px;
            letter-spacing: 0.3px;
            margin-left: 8px;
        }
        .vscode-btn {
            font-size: 14px;
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            opacity: 0.6;
            transition: opacity 0.2s, background 0.2s;
            background: rgba(0, 120, 212, 0.3);
            color: #60a5fa;
            margin-left: 8px;
        }
        .vscode-btn:hover {
            opacity: 1;
            background: rgba(0, 120, 212, 0.5);
        }
        .context-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 8px;
            margin-left: 16px;
        }
        .context-bar-container {
            flex: 1;
            height: 4px;
            background: rgba(255,255,255,0.1);
            border-radius: 2px;
            overflow: hidden;
        }
        .context-bar {
            height: 100%%;
            border-radius: 2px;
            transition: width 0.3s ease;
        }
        .context-percent {
            color: #888;
            font-size: 10px;
            width: 32px;
            text-align: right;
        }
        .summary {
            margin-top: 6px;
            margin-left: 16px;
            color: #999;
            font-size: 10px;
            line-height: 1.4;
        }
        .meta {
            margin-top: 4px;
            margin-left: 16px;
            color: #666;
            font-size: 9px;
        }
        .status-detail {
            color: #f59e0b;
            font-weight: 500;
        }
        .footer {
            padding: 8px 14px;
            background: rgba(255,255,255,0.03);
            border-top: 1px solid rgba(255,255,255,0.06);
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 10px;
            color: #666;
            flex-shrink: 0;
        }
        .footer-hint {
            color: #555;
        }
        .refresh-btn {
            cursor: pointer;
            opacity: 0.7;
            transition: opacity 0.2s;
            padding: 2px 6px;
            border-radius: 4px;
        }
        .refresh-btn:hover {
            opacity: 1;
            background: rgba(255,255,255,0.05);
        }
    </style>
    <script>
        function sendMessage(action, session) {
            try {
                webkit.messageHandlers.hammerspoon.postMessage({
                    action: action,
                    session: session || null
                });
            } catch(err) {
                console.log('Message handler error:', err);
            }
        }
    </script>
</head>
<body>
    <div class="header">
        <div class="header-title">
            <span class="icon">&#9889;</span>
            <span class="text">Claude Sessions</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
            <span class="header-badge">%d active</span>
            <span class="refresh-btn" onclick="sendMessage('refresh')">&#8635;</span>
        </div>
    </div>
    <div class="sessions">
        %s
    </div>
    <div class="footer">
        <span class="footer-hint">&#8984;&#8679;C to toggle</span>
    </div>
</body>
</html>
    ]], active_count, table.concat(rows, "\n"))
end

return M
