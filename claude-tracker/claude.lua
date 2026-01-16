-- claude.lua
-- Claude Code JSONL parsing and data extraction

local M = {}
local config = require("claude-tracker.config").config
local utils = require("claude-tracker.utils")

--- Find the most recent active JSONL session file in a project directory
-- JSONL files are named {uuid}.jsonl
-- @param project_dir string The Claude project directory name (e.g., "-Users-croach-projects-atrim")
-- @return string|nil Full path to the most recent JSONL file, or nil if not found
function M.find_active_session(project_dir)
    local full_path = config.claude_projects_dir .. project_dir

    -- List JSONL files sorted by modification time (most recent first)
    -- The pattern is: {uuid}.jsonl
    local cmd = string.format(
        "ls -t '%s'/*.jsonl 2>/dev/null | head -1",
        full_path
    )
    local output, status = hs.execute(cmd)

    if output and output ~= "" and status then
        return output:gsub("%s+$", "")  -- trim trailing whitespace/newlines
    end
    return nil
end

--- Find all recent Claude sessions for a project directory
-- @param project_dir string The Claude project directory name
-- @param max_sessions number|nil Maximum sessions to return (default: 5)
-- @param max_age_hours number|nil Maximum age in hours (default: 24)
-- @return table Array of {path, mtime, age, session_id} for each session file
function M.find_all_sessions(project_dir, max_sessions, max_age_hours)
    max_sessions = max_sessions or 5
    max_age_hours = max_age_hours or 24

    if not project_dir or project_dir == "" then
        return {}
    end

    local full_path = config.claude_projects_dir .. project_dir
    local sessions = {}

    -- Get recent JSONL files sorted by modification time
    local cmd = string.format(
        "ls -t '%s'/*.jsonl 2>/dev/null | head -%d",
        full_path, max_sessions * 2  -- Get more in case some are too old
    )
    local output, status = hs.execute(cmd)

    if not output or not status then
        return {}
    end

    local now = os.time()
    local max_age_seconds = max_age_hours * 3600

    for jsonl_path in output:gmatch("[^\n]+") do
        if jsonl_path ~= "" and #sessions < max_sessions then
            -- Get file modification time
            local attrs = hs.fs.attributes(jsonl_path)
            if attrs and attrs.modification then
                local age = now - attrs.modification
                if age <= max_age_seconds then
                    -- Extract session ID from filename
                    local session_id = jsonl_path:match("([^/]+)%.jsonl$")
                    table.insert(sessions, {
                        path = jsonl_path,
                        mtime = attrs.modification,
                        age = age,
                        session_id = session_id
                    })
                end
            end
        end
    end

    return sessions
end

--- Parse a JSONL session file to extract relevant data
-- @param jsonl_path string Full path to the JSONL file
-- @return table|nil Parsed session data or nil if parsing fails
function M.parse_session(jsonl_path)
    if not jsonl_path then return nil end

    local data = {
        tokens = { input = 0, output = 0, cache_read = 0, total = 0 },
        messages = {},
        model = nil,
        slug = nil,
        git_branch = nil,
        session_id = nil,
        last_timestamp = 0,
        active_tool = nil,
        pending_tool = nil,       -- Tool waiting for permission (tool_use without tool_result)
        pending_tool_ids = {},    -- Track tool_use IDs that haven't been resolved
        last_message_role = nil,  -- "user" or "assistant"
        -- Track the most recent context size (for calculating context %)
        current_context = 0,
    }

    -- Read last N lines for recent context (efficient for large files)
    local cmd = string.format("tail -100 '%s' 2>/dev/null", jsonl_path)
    local output, status = hs.execute(cmd)

    if not output or output == "" or not status then
        return nil
    end

    -- Process each line from the tail
    for line in output:gmatch("[^\n]+") do
        local entry = utils.safe_json_decode(line)
        if entry then
            M.process_entry(data, entry)
        end
    end

    -- Also read first few lines to get slug/branch (they appear early in session)
    local cmd_head = string.format("head -10 '%s' 2>/dev/null", jsonl_path)
    local head_output, head_status = hs.execute(cmd_head)

    if head_output and head_status then
        for line in head_output:gmatch("[^\n]+") do
            local entry = utils.safe_json_decode(line)
            if entry then
                -- Only extract metadata from head, don't reprocess tokens
                if entry.slug and not data.slug then
                    data.slug = entry.slug
                end
                if entry.gitBranch and not data.git_branch then
                    data.git_branch = entry.gitBranch
                end
                if entry.sessionId and not data.session_id then
                    data.session_id = entry.sessionId
                end
            end
        end
    end

    return data
end

--- Process a single JSONL entry and update data
-- @param data table The data object to update
-- @param entry table The parsed JSONL entry
function M.process_entry(data, entry)
    -- Extract metadata from any entry
    if entry.slug then data.slug = entry.slug end
    if entry.gitBranch then data.git_branch = entry.gitBranch end
    if entry.sessionId then data.session_id = entry.sessionId end

    -- Track latest timestamp
    if entry.timestamp then
        local ts = utils.parse_timestamp(entry.timestamp)
        if ts > data.last_timestamp then
            data.last_timestamp = ts
        end
    end

    -- Extract model and usage from assistant messages
    if entry.type == "assistant" and entry.message then
        data.last_message_role = "assistant"
        local msg = entry.message
        if msg.model then
            data.model = msg.model
        end
        if msg.usage then
            -- Track current context usage (input + cache_read = current context window usage)
            local input = msg.usage.input_tokens or 0
            local cache_read = msg.usage.cache_read_input_tokens or 0
            data.current_context = input + cache_read

            -- Also track totals for reference
            data.tokens.input = input
            data.tokens.cache_read = cache_read
            data.tokens.output = msg.usage.output_tokens or 0
        end

        -- Check for tool_use blocks - track as pending until we see tool_result
        if msg.content and type(msg.content) == "table" then
            data.active_tool = nil  -- Reset before checking
            for _, block in ipairs(msg.content) do
                if block.type == "tool_use" and block.id then
                    data.active_tool = block.name
                    -- Track this tool_use as pending
                    data.pending_tool_ids[block.id] = block.name
                    data.pending_tool = block.name
                end
            end
        end
    end

    -- Extract user messages for summary generation
    -- Also check for tool_result which resolves pending tools
    if entry.type == "user" and entry.message then
        data.last_message_role = "user"
        local content = entry.message.content
        if type(content) == "string" then
            table.insert(data.messages, content)
        elseif type(content) == "table" then
            for _, block in ipairs(content) do
                if block.type == "text" and block.text then
                    table.insert(data.messages, block.text)
                elseif block.type == "tool_result" and block.tool_use_id then
                    -- This tool_use has been resolved
                    data.pending_tool_ids[block.tool_use_id] = nil
                end
            end
        end

        -- Update pending_tool based on remaining unresolved tool_uses
        data.pending_tool = nil
        for _, tool_name in pairs(data.pending_tool_ids) do
            data.pending_tool = tool_name  -- Take any remaining pending tool
            break
        end
    end
end

--- Calculate context window utilization percentage
-- @param data table Session data with current_context
-- @param model string|nil The model name
-- @return number Percentage (0-100)
function M.calculate_context_percent(data, model)
    local context_used = data.current_context or 0

    -- Get context window size for this model
    local window = config.context_windows.default
    if model and config.context_windows[model] then
        window = config.context_windows[model]
    end

    local percent = math.floor((context_used / window) * 100)
    return math.min(percent, 100)  -- Cap at 100%
end

--- Determine session status based on activity
-- @param data table Session data with active_tool, last_timestamp, last_message_role, pending_tool
-- @param is_attached boolean Whether tmux session is attached
-- @param last_activity_seconds number Seconds since last activity
-- @return string status, string status_detail
function M.determine_status(data, is_attached, last_activity_seconds)
    local status, detail

    -- Check for pending tool permission (tool_use without tool_result)
    if data.pending_tool and last_activity_seconds < 600 then
        status = "waiting"
        -- Format tool name nicely
        local tool = data.pending_tool
        if tool == "Bash" then
            detail = "permission: bash"
        elseif tool == "Edit" or tool == "Write" then
            detail = "permission: file edit"
        elseif tool == "TodoWrite" then
            detail = "permission: todo"
        else
            detail = "permission: " .. tool:lower()
        end
    -- Only consider "working" if activity is very recent (< 2 min)
    elseif data.active_tool and last_activity_seconds < 120 then
        status = "working"
        detail = "running: " .. data.active_tool:lower()
    elseif data.last_message_role == "assistant" and last_activity_seconds < 600 then
        status = "waiting"
        detail = "awaiting input"
    elseif is_attached and last_activity_seconds < 120 then
        status = "active"
        detail = nil
    else
        status = "idle"
        detail = nil
    end

    return status, detail
end

--- Check if a message is a system/command message that should be skipped
-- @param msg string The message to check
-- @return boolean True if this is a system message
local function is_system_message(msg)
    if not msg then return true end
    -- Skip XML tags, slash commands, and other system messages
    if msg:match("^<") then return true end           -- XML tags
    if msg:match("^/") then return true end           -- Slash commands
    if msg:match("command%-name") then return true end -- XML command tags
    if msg:match("system%-reminder") then return true end -- System reminders
    if msg:match("^%s*$") then return true end        -- Empty/whitespace only
    return false
end

--- Generate a summary from recent messages
-- @param messages table Array of user messages
-- @param max_length number|nil Maximum summary length (default: 120)
-- @return string Summary text
function M.generate_summary(messages, max_length)
    max_length = max_length or 120

    if #messages == 0 then
        return "No recent activity"
    end

    -- Find the last non-system message (iterate backwards)
    local last_msg = nil
    for i = #messages, 1, -1 do
        if not is_system_message(messages[i]) then
            last_msg = messages[i]
            break
        end
    end

    if not last_msg then
        return "No recent activity"
    end

    -- Clean and truncate
    local summary = utils.clean_whitespace(last_msg)
    return utils.truncate(summary, max_length)
end

return M
