-- llm.lua
-- Local LLM integration for intelligent session analysis (async)

local M = {}
local utils = require("claude-tracker.utils")

-- LM Studio endpoint
local LLM_URL = "http://localhost:1234/v1/chat/completions"
local MODEL = "qwen/qwen3-30b-a3b-2507"

-- Cache for LLM results
M.cache = {}
local CACHE_TTL = 10  -- seconds - longer cache since async

-- Track in-flight requests to avoid duplicates
M.pending = {}

--- Analyze JSONL entries to determine status and generate summary (async)
-- Returns cached data immediately, kicks off async request if cache is stale
-- @param jsonl_path string Path to the JSONL file
-- @param session_name string The session name for cache key
-- @param num_entries number|nil Number of recent entries to analyze (default: 10)
-- @return table|nil { state = string, detail = string|nil, summary = string|nil } or nil if no cache
function M.analyze_session(jsonl_path, session_name, num_entries)
    num_entries = num_entries or 10

    if not jsonl_path then
        return nil
    end

    local cache_key = session_name or jsonl_path
    local cached = M.cache[cache_key]
    local now = os.time()

    -- Return fresh cache immediately
    if cached and (now - cached.time) < CACHE_TTL then
        return cached.result
    end

    -- If request already in flight, return stale cache or nil
    if M.pending[cache_key] then
        return cached and cached.result or nil
    end

    -- Mark as pending and kick off async request
    M.pending[cache_key] = true
    M.fetch_async(jsonl_path, cache_key, num_entries)

    -- Return stale cache while we wait, or nil
    return cached and cached.result or nil
end

--- Async fetch and process LLM response
-- @param jsonl_path string Path to the JSONL file
-- @param cache_key string Cache key for storing result
-- @param num_entries number Number of entries to analyze
function M.fetch_async(jsonl_path, cache_key, num_entries)
    -- Read last N lines from JSONL file
    local cmd = string.format("tail -%d '%s' 2>/dev/null", num_entries, jsonl_path)
    local output, status = hs.execute(cmd)

    if not output or output == "" or not status then
        M.pending[cache_key] = nil
        return
    end

    -- Parse entries and build a condensed view for the LLM
    local entries = {}
    for line in output:gmatch("[^\n]+") do
        local entry = utils.safe_json_decode(line)
        if entry then
            local condensed = {
                type = entry.type,
                timestamp = entry.timestamp,
            }

            if entry.type == "user" and entry.message then
                local content = entry.message.content
                if type(content) == "string" then
                    condensed.content = content:sub(1, 200)
                elseif type(content) == "table" then
                    for _, block in ipairs(content) do
                        if block.type == "text" then
                            condensed.content = (block.text or ""):sub(1, 200)
                            break
                        elseif block.type == "tool_result" then
                            condensed.tool_result = block.tool_use_id
                        end
                    end
                end
            elseif entry.type == "assistant" and entry.message then
                if entry.message.content and type(entry.message.content) == "table" then
                    for _, block in ipairs(entry.message.content) do
                        if block.type == "text" then
                            condensed.content = (block.text or ""):sub(1, 300)
                        elseif block.type == "tool_use" then
                            condensed.tool = block.name
                            if block.input then
                                if block.input.command then
                                    condensed.tool_input = block.input.command:sub(1, 50)
                                elseif block.input.file_path then
                                    condensed.tool_input = block.input.file_path
                                end
                            end
                        end
                    end
                end
            end

            table.insert(entries, condensed)
        end
    end

    if #entries == 0 then
        M.cache[cache_key] = {
            time = os.time(),
            result = { state = "idle", detail = nil, summary = "No recent activity" }
        }
        M.pending[cache_key] = nil
        return
    end

    local system_prompt = [[You analyze Claude Code session data to determine status and summarize activity.

Respond with ONLY a JSON object (no markdown, no thinking, no explanation):
{"state": "STATE", "detail": "DETAIL", "summary": "SUMMARY"}

STATE must be one of:
- "working" - Last entry shows Claude using tools or generating response (assistant with tool_use, no tool_result yet)
- "permission" - Claude used a tool that needs approval (Bash, Edit, Write, Task) and there's no tool_result following
- "waiting" - Claude's last message was text response (no pending tools), waiting for user input
- "idle" - No recent meaningful activity

DETAIL: Brief context (e.g., "processing", "approve: bash", "awaiting input")

SUMMARY: 1-2 sentence summary of what's happening or was last discussed. Focus on the actual task/topic.]]

    local entries_json = hs.json.encode(entries)
    local user_prompt = "Analyze these recent session entries (oldest to newest):\n\n" .. entries_json

    local request_body = hs.json.encode({
        model = MODEL,
        messages = {
            { role = "system", content = system_prompt },
            { role = "user", content = user_prompt }
        },
        temperature = 0.1,
        max_tokens = 200,
        stream = false
    })

    -- Async HTTP request - won't block!
    hs.http.asyncPost(LLM_URL, request_body, { ["Content-Type"] = "application/json" },
        function(status_code, response_body, headers)
            M.pending[cache_key] = nil

            if status_code ~= 200 or not response_body then
                print("[claude-tracker:llm] Async request failed: " .. tostring(status_code))
                return
            end

            local response = utils.safe_json_decode(response_body)
            if not response or not response.choices or not response.choices[1] then
                return
            end

            local content = response.choices[1].message and response.choices[1].message.content
            if not content then return end

            -- Parse the JSON response
            content = content:gsub("```json%s*", ""):gsub("```%s*", "")
            content = content:gsub("<think>.-</think>", "")
            content = content:gsub("^%s+", ""):gsub("%s+$", "")

            local json_match = content:match("%b{}")
            if json_match then
                content = json_match
            end

            local result = utils.safe_json_decode(content)
            if not result or not result.state then
                print("[claude-tracker:llm] Could not parse: " .. content:sub(1, 100))
                return
            end

            -- Update cache - will be picked up on next refresh
            M.cache[cache_key] = {
                time = os.time(),
                result = result
            }
        end
    )
end

--- Clear the cache
function M.clear_cache()
    M.cache = {}
    M.pending = {}
end

-- Availability state
M.available = nil  -- nil = unknown, true/false after check
M.availability_checked = false

--- Check if LLM server is available (async, non-blocking)
-- First call returns true optimistically, then updates based on actual check
-- @return boolean True if server is (probably) available
function M.is_available()
    -- If we've already checked, return cached result
    if M.availability_checked then
        return M.available == true
    end

    -- Optimistically assume available, check async
    M.availability_checked = true
    M.available = true  -- Assume yes until proven otherwise

    -- Async check - update state when we know for sure
    hs.http.asyncGet(LLM_URL:gsub("/chat/completions", "/models"), {},
        function(status_code, body, headers)
            M.available = (status_code == 200)
            if M.available then
                print("[claude-tracker:llm] LLM server confirmed available")
            else
                print("[claude-tracker:llm] LLM server not available (status: " .. tostring(status_code) .. ")")
            end
        end
    )

    return true  -- Optimistic return
end

--- Reset availability check (useful if LM Studio was started after Hammerspoon)
function M.reset_availability()
    M.availability_checked = false
    M.available = nil
end

return M
