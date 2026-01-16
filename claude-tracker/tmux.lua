-- tmux.lua
-- tmux session discovery and control for Claude Session Tracker

local M = {}
local config = require("claude-tracker.config").config

-- Full path to tmux (Hammerspoon may not have /opt/homebrew/bin in PATH)
local TMUX = "/opt/homebrew/bin/tmux"

--- Get all tmux sessions matching the configured pattern
-- @return table Map of session_name -> { path = string, attached = boolean }
function M.get_sessions()
    local sessions = {}

    -- Use ||| as separator since it won't appear in session names or paths
    -- Format: name|||path|||attached(0|1)
    local cmd = TMUX .. " list-sessions -F '#{session_name}|||#{session_path}|||#{session_attached}' 2>/dev/null"
    local output, status = hs.execute(cmd)

    if not output or output == "" or not status then
        return sessions
    end

    for line in output:gmatch("[^\n]+") do
        -- Split by |||
        -- Note: attached can be any number (count of attached clients), not just 0/1
        local name, path, attached = line:match("(.-)|||(.-)|||(%d+)")
        if name and path then
            -- Check if session name matches our pattern
            if name:match(config.tmux_session_pattern) then
                sessions[name] = {
                    path = path,
                    attached = (tonumber(attached) > 0)  -- Any non-zero means attached
                }
            end
        end
    end
    return sessions
end

--- Get windows for a specific tmux session
-- @param session_name string The tmux session name
-- @return table Map of window_name -> window_index
function M.get_windows(session_name)
    local windows = {}

    -- Escape session name for shell (handle spaces and special chars)
    local escaped_name = session_name:gsub("'", "'\\''")
    local cmd = string.format(
        TMUX .. " list-windows -t '%s' -F '#{window_index}\t#{window_name}' 2>/dev/null",
        escaped_name
    )
    local output, status = hs.execute(cmd)

    if output and status then
        for line in output:gmatch("[^\n]+") do
            local idx, name = line:match("(%d+)\t(.+)")
            if idx and name then
                windows[name] = tonumber(idx)
            end
        end
    end

    return windows
end

--- Focus a tmux session (switch to it and focus the terminal app)
-- @param session_name string The tmux session name
-- @param window_name string|nil The window name to focus (default: "claude")
function M.focus_session(session_name, window_name)
    window_name = window_name or "claude"

    -- Escape session name for shell
    local escaped_name = session_name:gsub("'", "'\\''")

    -- TODO: tmux switching not working reliably, commented out for now
    -- -- Try to switch tmux client to the session:window
    -- -- If no client is attached, attach a new one
    -- local cmd = string.format(
    --     TMUX .. " switch-client -t '%s:%s' 2>/dev/null || " .. TMUX .. " select-window -t '%s:%s' 2>/dev/null",
    --     escaped_name, window_name,
    --     escaped_name, window_name
    -- )
    -- hs.execute(cmd)

    -- Focus the terminal/editor app
    local app = hs.application.find(config.terminal_app)
    if app then
        app:activate()
    else
        hs.application.launchOrFocus(config.terminal_app)
    end
end

--- Check if tmux is running
-- @return boolean True if tmux server is running
function M.is_running()
    local output, status = hs.execute(TMUX .. " list-sessions 2>/dev/null")
    return status and output and output ~= ""
end

--- Capture the visible content of a tmux pane
-- @param session_name string The tmux session name
-- @param window_name string|nil The window name (default: current window)
-- @return string|nil The pane content, or nil if capture fails
function M.capture_pane(session_name, window_name)
    local escaped_name = session_name:gsub("'", "'\\''")
    local target = escaped_name
    if window_name then
        target = target .. ":" .. window_name
    end

    -- Capture last 50 lines of the pane
    local cmd = string.format(
        TMUX .. " capture-pane -t '%s' -p -S -50 2>/dev/null",
        target
    )
    local output, status = hs.execute(cmd)

    if output and status then
        return output
    end
    return nil
end

--- Detect the terminal state from pane content
-- @param pane_content string The captured pane content
-- @return table { state = string, detail = string|nil, action = string|nil }
function M.detect_pane_state(pane_content)
    if not pane_content or pane_content == "" then
        return { state = "unknown", detail = nil }
    end

    -- Get the last ~20 lines for analysis (most relevant)
    local lines = {}
    for line in pane_content:gmatch("[^\n]+") do
        table.insert(lines, line)
    end
    local recent = table.concat(lines, "\n", math.max(1, #lines - 20), #lines)

    -- Check for permission prompt patterns
    if recent:match("Do you want to proceed%?") or recent:match("Yes.*No") then
        -- Try to extract what permission is being requested
        local action = nil
        if recent:match("Bash command") or recent:match("Bash%(") then
            -- Try to extract the command
            local cmd = recent:match("Bash%(([^%)]+)%)") or recent:match("git [%w%-]+")
            action = cmd and ("bash: " .. cmd:sub(1, 30)) or "bash command"
        elseif recent:match("Edit") or recent:match("Write") then
            action = "file edit"
        elseif recent:match("Task") then
            action = "task"
        else
            action = "action"
        end
        return { state = "permission", detail = "approve: " .. action }
    end

    -- Check for running/processing state
    if recent:match("Running") or recent:match("⏳") or recent:match("%.%.%.%s*$") then
        local tool = recent:match("([%w]+)%(") or "tool"
        return { state = "working", detail = "running: " .. tool:lower() }
    end

    -- Check for completion patterns
    if recent:match("PR created:") or recent:match("https://github%.com/[^%s]+/pull/%d+") then
        return { state = "waiting", detail = "PR created" }
    end

    if recent:match("commit%s+%x+") or recent:match("Successfully committed") then
        return { state = "waiting", detail = "committed" }
    end

    -- Check for user input prompt (Claude waiting for input)
    if recent:match("❯") or recent:match(">%s*$") or recent:match("claude>") then
        return { state = "waiting", detail = "awaiting input" }
    end

    -- Check for error states
    if recent:match("Error:") or recent:match("error:") or recent:match("failed") then
        return { state = "error", detail = "error occurred" }
    end

    -- Default: idle or unknown
    return { state = "idle", detail = nil }
end

--- Get GitHub repo name from a directory path
-- Runs git remote get-url origin and parses the repo name
-- @param path string The directory path
-- @return string|nil The repo name (e.g., "atrim-instrumentation") or nil
function M.get_github_repo(path)
    if not path or path == "" then return nil end

    local escaped_path = path:gsub("'", "'\\''")
    local cmd = string.format(
        "git -C '%s' remote get-url origin 2>/dev/null",
        escaped_path
    )
    local output, status = hs.execute(cmd)

    if not output or not status or output == "" then
        return nil
    end

    -- Parse repo name from various URL formats:
    -- git@github.com:owner/repo.git
    -- https://github.com/owner/repo.git
    -- https://github.com/owner/repo
    local repo = output:match("[:/]([^/]+/[^/]+)%.git%s*$")  -- with .git
        or output:match("[:/]([^/]+/[^/]+)%s*$")            -- without .git

    if repo then
        -- Return just the repo name, not owner/repo
        local repo_name = repo:match("/(.+)$")
        return repo_name
    end

    return nil
end

return M
