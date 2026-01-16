-- capture.lua
-- Captures permission prompts for settings.json configuration

local M = {}
local config = require("claude-tracker.config").config
local utils = require("claude-tracker.utils")

-- Track captured tool IDs to avoid duplicates (in-memory cache)
local captured_ids = {}

--- Generate a settings rule string from tool info
-- @param tool_info table { name, input, id, timestamp }
-- @return string Settings rule like "Bash(npm test)" or "Edit(/path/file.ts)"
function M.generate_settings_rule(tool_info)
    local name = tool_info.name
    local input = tool_info.input or {}

    if name == "Bash" then
        -- Extract command from input
        local cmd = input.command or ""
        -- Truncate long commands and clean whitespace
        cmd = utils.clean_whitespace(cmd)
        if #cmd > 80 then
            cmd = cmd:sub(1, 77) .. "..."
        end
        return string.format("Bash(%s)", cmd)

    elseif name == "Edit" or name == "Write" or name == "Read" then
        -- File operations - use file_path
        local path = input.file_path or ""
        return string.format("%s(%s)", name, path)

    elseif name == "Task" then
        -- Task agent - use subagent_type and brief description
        local agent = input.subagent_type or "unknown"
        local desc = input.description or ""
        return string.format("Task(%s: %s)", agent, utils.truncate(desc, 40))

    elseif name == "WebFetch" then
        local url = input.url or ""
        return string.format("WebFetch(%s)", url)

    elseif name == "Grep" then
        local pattern = input.pattern or ""
        return string.format("Grep(%s)", pattern)

    elseif name == "Glob" then
        local pattern = input.pattern or ""
        return string.format("Glob(%s)", pattern)

    else
        -- Generic format for other tools
        return string.format("%s(*)", name)
    end
end

--- Generate a more flexible pattern for settings.json
-- Returns patterns of increasing specificity
-- @param tool_info table { name, input, id, timestamp }
-- @return table Array of patterns from specific to broad
function M.generate_patterns(tool_info)
    local patterns = {}
    local name = tool_info.name
    local input = tool_info.input or {}

    if name == "Bash" then
        local cmd = input.command or ""
        -- Level 1: Exact command
        table.insert(patterns, string.format("Bash(%s)", cmd))
        -- Level 2: Command prefix (first word/program)
        local program = cmd:match("^([%w_%-%.]+)")
        if program then
            table.insert(patterns, string.format("Bash(%s *)", program))
        end
        -- Level 3: All bash
        table.insert(patterns, "Bash(*)")

    elseif name == "Edit" or name == "Write" or name == "Read" then
        local path = input.file_path or ""
        -- Level 1: Exact path
        table.insert(patterns, string.format("%s(%s)", name, path))
        -- Level 2: Directory pattern
        local dir = path:match("(.*/)")
        if dir then
            table.insert(patterns, string.format("%s(%s*)", name, dir))
        end
        -- Level 3: All operations of this type
        table.insert(patterns, string.format("%s(*)", name))

    elseif name == "Task" then
        local agent = input.subagent_type or ""
        -- Level 1: Specific agent type
        table.insert(patterns, string.format("Task(%s:*)", agent))
        -- Level 2: All tasks
        table.insert(patterns, "Task(*)")

    else
        table.insert(patterns, string.format("%s(*)", name))
    end

    return patterns
end

--- Build a capture entry with full context
-- @param session_data table Session data from gather_sessions
-- @param tool_info table Tool use info { name, input, id, timestamp }
-- @return table Capture entry for JSONL
function M.build_capture_entry(session_data, tool_info)
    return {
        -- When captured
        captured_at = os.date("!%Y-%m-%dT%H:%M:%SZ"),
        -- Tool details
        tool_use_id = tool_info.id,
        tool_name = tool_info.name,
        tool_input = tool_info.input,
        tool_timestamp = tool_info.timestamp,
        -- Generated rule
        settings_rule = M.generate_settings_rule(tool_info),
        settings_patterns = M.generate_patterns(tool_info),
        -- Context
        context = {
            project_path = session_data.tmux_path,
            claude_project_dir = session_data.claude_project_dir,
            session_id = session_data.session_id,
            slug = session_data.slug,
            git_branch = session_data.git_branch,
            github_repo = session_data.github_repo,
            tmux_session = session_data.tmux_session_base or session_data.tmux_session,
        },
        -- Status for future review UI
        status = "pending",  -- pending, approved, denied
    }
end

--- Check if a tool_use has already been captured
-- @param tool_use_id string The tool use ID
-- @return boolean True if already captured
function M.is_captured(tool_use_id)
    return captured_ids[tool_use_id] ~= nil
end

--- Mark a tool_use as captured
-- @param tool_use_id string The tool use ID
function M.mark_captured(tool_use_id)
    captured_ids[tool_use_id] = os.time()
end

--- Write a capture entry to the JSONL file
-- @param entry table The capture entry
-- @return boolean Success
function M.write_capture(entry)
    local file_path = config.capture_file
    if not file_path then
        return false
    end

    -- Encode to JSON
    local json = hs.json.encode(entry)
    if not json then
        return false
    end

    -- Append to file
    local file = io.open(file_path, "a")
    if not file then
        return false
    end

    file:write(json .. "\n")
    file:close()

    return true
end

--- Capture all tool_use blocks from a session
-- Called during refresh cycle - captures ALL tools, not just pending ones
-- @param session_data table Session data with claude_data.all_tool_uses
-- @return number Number of new captures
function M.capture_all_tools(session_data)
    local claude_data = session_data.claude_data
    if not claude_data or not claude_data.all_tool_uses then
        return 0
    end

    local count = 0
    for _, tool_info in ipairs(claude_data.all_tool_uses) do
        if tool_info.id and not M.is_captured(tool_info.id) then
            local entry = M.build_capture_entry(session_data, tool_info)
            if M.write_capture(entry) then
                M.mark_captured(tool_info.id)
                count = count + 1
            end
        end
    end

    return count
end

-- Alias for backwards compatibility
M.capture_pending_tools = M.capture_all_tools

--- Load previously captured IDs from file (for dedup across restarts)
-- Called during init
function M.load_captured_ids()
    local file_path = config.capture_file
    if not file_path then
        return
    end

    local file = io.open(file_path, "r")
    if not file then
        return
    end

    for line in file:lines() do
        local entry = utils.safe_json_decode(line)
        if entry and entry.tool_use_id then
            captured_ids[entry.tool_use_id] = true
        end
    end

    file:close()
end

--- Get all captured prompts (for future panel display)
-- @param limit number|nil Maximum entries to return (default: 50)
-- @return table Array of capture entries
function M.get_captured_prompts(limit)
    limit = limit or 50
    local file_path = config.capture_file
    if not file_path then
        return {}
    end

    local entries = {}
    local file = io.open(file_path, "r")
    if not file then
        return {}
    end

    for line in file:lines() do
        local entry = utils.safe_json_decode(line)
        if entry then
            table.insert(entries, entry)
        end
    end

    file:close()

    -- Return most recent entries (last N)
    local start = math.max(1, #entries - limit + 1)
    local result = {}
    for i = start, #entries do
        table.insert(result, entries[i])
    end

    return result
end

return M
