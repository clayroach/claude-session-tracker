-- claude-tracker/init.lua
-- Main module for Claude Session Tracker
-- Orchestrates tmux discovery, Claude data parsing, and panel display

local M = {}

local config = require("claude-tracker.config").config
local tmux = require("claude-tracker.tmux")
local claude = require("claude-tracker.claude")
local panel = require("claude-tracker.panel")
local utils = require("claude-tracker.utils")
local capture = require("claude-tracker.capture")

-- Module state
M.hotkey = nil

--- Gather all session data by combining tmux sessions with Claude data
-- Each tmux session can have multiple Claude sessions (different windows)
-- @return table Array of session data objects
function M.gather_sessions()
    local sessions = {}
    local seen_projects = {}  -- Track project dirs to avoid duplicates

    -- Get tmux sessions matching our pattern
    local tmux_sessions = tmux.get_sessions()

    -- Sort session names so named sessions come before numeric ones
    local sorted_names = {}
    for name in pairs(tmux_sessions) do
        table.insert(sorted_names, name)
    end
    table.sort(sorted_names, function(a, b)
        -- Named sessions (start with letter) before numeric
        local a_named = a:match("^%a")
        local b_named = b:match("^%a")
        if a_named and not b_named then return true end
        if b_named and not a_named then return false end
        return a < b
    end)

    for _, session_name in ipairs(sorted_names) do
        local session_info = tmux_sessions[session_name]

        -- Map tmux path to Claude project directory
        local project_dir = utils.path_to_claude_project(session_info.path)

        -- Skip if we've already seen this project directory
        -- (prefer named sessions which come first due to sorting)
        if seen_projects[project_dir] then
            goto continue
        end
        seen_projects[project_dir] = true

        -- Find the most recent Claude session for this project
        local claude_sessions = claude.find_all_sessions(project_dir, 1, 48)  -- Most recent session only, 48 hours old

        if #claude_sessions == 0 then
            -- No Claude sessions - skip (don't show placeholder for every tmux session)
            goto continue
        else
            -- Show the most recent Claude session for this tmux session
            local claude_session = claude_sessions[1]
            local data = M.build_session_data_with_claude(
                session_name, session_info, claude_session, 1
            )
            if data then
                table.insert(sessions, data)
            end
        end

        ::continue::
    end

    -- Sort by last activity timestamp (most recent first)
    table.sort(sessions, function(a, b)
        local a_ts = a.last_activity_timestamp or 0
        local b_ts = b.last_activity_timestamp or 0
        return a_ts > b_ts
    end)

    -- Capture all tool_use blocks (for settings.json configuration)
    for _, session_data in ipairs(sessions) do
        if session_data.claude_data and session_data.claude_data.all_tool_uses then
            capture.capture_all_tools(session_data)
        end
    end

    return sessions
end

--- Build session data for a tmux session without Claude data
-- @param tmux_session string The tmux session name
-- @param tmux_info table tmux session info { path, attached }
-- @return table Session data object
function M.build_session_data_without_claude(tmux_session, tmux_info)
    return {
        tmux_session = tmux_session,
        tmux_path = tmux_info.path,
        is_attached = tmux_info.attached,
        display_name = M.extract_display_name(tmux_session),
        session_index = nil,
        status = "idle",
        status_detail = nil,
        context_percent = 0,
        summary = "No Claude session",
        last_activity = "unknown",
        last_activity_timestamp = 0,
        model = nil,
        tokens = { input = 0, output = 0, cache_read = 0, total = 0 },
    }
end

--- Build session data for a tmux session with Claude data
-- @param tmux_session string The tmux session name
-- @param tmux_info table tmux session info { path, attached }
-- @param claude_session table Claude session info { path, mtime, age, session_id }
-- @param index number Index of this Claude session (1, 2, 3...)
-- @return table|nil Session data object or nil
function M.build_session_data_with_claude(tmux_session, tmux_info, claude_session, index)
    -- Map tmux path to Claude project directory
    local project_dir = utils.path_to_claude_project(tmux_info.path)

    -- Parse Claude data from the specific session file
    local claude_data = claude.parse_session(claude_session.path)
    if not claude_data then
        return nil
    end

    -- Skip sessions with no valid timestamp (timestamp = 0 means no activity found)
    -- This filters out empty or corrupted session files
    local now = os.time()
    local content_age = 0
    if not claude_data.last_timestamp or claude_data.last_timestamp == 0 then
        return nil
    else
        content_age = now - claude_data.last_timestamp
    end

    -- Note: We don't filter by age here - if the file exists and has valid timestamps,
    -- show it. The file age filtering is done in find_all_sessions() based on file mtime.

    -- Calculate derived values
    local context_percent = claude.calculate_context_percent(claude_data, claude_data.model)
    local last_activity_seconds = content_age  -- Reuse already-calculated age

    -- Try LLM-based analysis first (provides both status and summary)
    local status, status_detail, summary
    local llm_result = nil

    -- Lazy load LLM module
    if M.llm == nil then
        local ok, llm_module = pcall(require, "claude-tracker.llm")
        if ok then
            M.llm = llm_module
            M.llm_available = llm_module.is_available()
            if M.llm_available then
                print("[claude-tracker] LLM available at localhost:1234")
            else
                print("[claude-tracker] LLM not available, using fallback")
            end
        else
            M.llm = false
            M.llm_available = false
        end
    end

    -- Use LLM if available and session is recent
    -- LLM is async - returns cached result or nil (while fetching in background)
    if M.llm_available and M.llm and last_activity_seconds < 600 then
        llm_result = M.llm.analyze_session(claude_session.path, tmux_session)
        if llm_result and llm_result.state and llm_result.state ~= "unknown" then
            status = llm_result.state
            status_detail = llm_result.detail
            summary = llm_result.summary
        end
        -- If llm_result is nil, LLM is fetching - we'll use fallback this cycle
        -- and get LLM results on next refresh
    end

    -- Fallback to pattern-based detection if LLM didn't work
    if not status then
        -- Try pane-based detection
        local pane_content = tmux.capture_pane(tmux_session, "claude")
        local pane_state = tmux.detect_pane_state(pane_content, tmux_session)

        if pane_state.state ~= "unknown" and pane_state.state ~= "idle" and last_activity_seconds < 600 then
            status = pane_state.state
            status_detail = pane_state.detail
        else
            status, status_detail = claude.determine_status(claude_data, tmux_info.attached, last_activity_seconds)
        end
    end

    -- Fallback summary if LLM didn't provide one
    if not summary then
        summary = claude.generate_summary(claude_data.messages, claude_data.assistant_messages, 150)
    end

    -- Get GitHub repo name from git remote
    local github_repo = tmux.get_github_repo(tmux_info.path)

    -- Create unique identifier for this session
    local unique_id = tmux_session
    if index > 1 then
        unique_id = tmux_session .. "-" .. index
    end

    return {
        tmux_session = unique_id,  -- Use unique ID for click handling
        tmux_session_base = tmux_session,  -- Original tmux session name
        tmux_path = tmux_info.path,
        is_attached = tmux_info.attached,
        session_index = index,  -- Which Claude session this is (1, 2, 3...)

        claude_project_dir = project_dir,
        session_id = claude_session.session_id,
        slug = claude_data.slug,
        model = claude_data.model,
        git_branch = claude_data.git_branch,
        github_repo = github_repo,  -- Repo name from git remote

        tokens = claude_data.tokens,
        context_percent = context_percent,

        status = status,
        status_detail = status_detail,
        last_activity = utils.time_ago(last_activity_seconds),
        last_activity_timestamp = claude_data.last_timestamp or 0,

        summary = summary,
        active_tool = claude_data.active_tool,
        pending_tool = claude_data.pending_tool,

        -- Display name: include index for multiple sessions
        display_name = M.extract_display_name(tmux_session) .. (index > 1 and (" #" .. index) or ""),

        -- Full claude data for capture module
        claude_data = claude_data,
    }
end

--- Extract a clean display name from tmux session name
-- e.g., "atrim2-effect-ai-effect-ai" -> "effect-ai"
-- e.g., "atrim-fix env vars" -> "fix env vars"
-- @param session_name string The full tmux session name
-- @return string Clean display name
function M.extract_display_name(session_name)
    -- Remove the project prefix pattern (e.g., "atrim2-" or "atrim-")
    local display = session_name:gsub("^atrim[0-9]*%-", "")

    -- If unchanged, try to extract last meaningful part
    if display == session_name then
        -- Split by hyphen and take everything after first part
        local parts = {}
        for part in session_name:gmatch("[^%-]+") do
            table.insert(parts, part)
        end
        if #parts > 1 then
            table.remove(parts, 1)
            display = table.concat(parts, "-")
        end
    end

    -- Remove duplicate suffix if present (e.g., "effect-ai-effect-ai" -> "effect-ai")
    local half_len = math.floor(#display / 2)
    if half_len > 0 then
        local first_half = display:sub(1, half_len)
        local second_half = display:sub(half_len + 2)  -- +2 to skip the separator
        if first_half == second_half then
            display = first_half
        end
    end

    return display
end

--- Initialize the Claude Session Tracker
function M.init()
    -- Load previously captured IDs for deduplication
    capture.load_captured_ids()

    -- Set up the refresh callback for the panel
    panel.refresh_callback = M.gather_sessions

    -- Bind hotkey for toggle
    M.hotkey = hs.hotkey.bind(config.hotkey, config.hotkey_key, function()
        panel.toggle()
    end)

    -- Show notification
    hs.alert.show("Claude Session Tracker loaded (Cmd+Shift+C to toggle)", 2)

    -- Optionally auto-show panel on init
    -- panel.show()
end

--- Show the panel
function M.show()
    panel.show()
end

--- Hide the panel
function M.hide()
    panel.hide()
end

--- Toggle panel visibility
function M.toggle()
    panel.toggle()
end

--- Manually refresh data
function M.refresh()
    panel.refresh()
end

--- Clean up resources
function M.destroy()
    if M.hotkey then
        M.hotkey:delete()
        M.hotkey = nil
    end
    panel.destroy()
end

return M
