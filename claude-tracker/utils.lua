-- utils.lua
-- Shared utilities for Claude Session Tracker

local M = {}

--- Convert a filesystem path to Claude project directory name
-- e.g., "/Users/croach/projects/atrim2" -> "-Users-croach-projects-atrim2"
-- @param path string The filesystem path
-- @return string The Claude project directory name
function M.path_to_claude_project(path)
    if not path then return nil end
    -- Remove trailing slash if present
    path = path:gsub("/$", "")
    -- Replace / with - (the leading / becomes the leading -)
    return path:gsub("/", "-")
end

--- Parse ISO 8601 timestamp to Unix time
-- e.g., "2026-01-15T20:52:55.836Z" -> 1736977975
-- @param iso_str string The ISO 8601 timestamp
-- @return number Unix timestamp (0 if parsing fails)
function M.parse_timestamp(iso_str)
    if not iso_str then return 0 end

    -- Parse: 2026-01-15T20:52:55.836Z
    local year, month, day, hour, min, sec = iso_str:match(
        "(%d+)-(%d+)-(%d+)T(%d+):(%d+):(%d+)"
    )

    if year then
        return os.time({
            year = tonumber(year),
            month = tonumber(month),
            day = tonumber(day),
            hour = tonumber(hour),
            min = tonumber(min),
            sec = tonumber(sec),
        })
    end
    return 0
end

--- Convert seconds to human-readable "time ago" format
-- @param seconds number Number of seconds ago
-- @return string Human readable format ("now", "2m ago", "1h ago", etc.)
function M.time_ago(seconds)
    if not seconds or seconds < 0 then
        return "unknown"
    elseif seconds < 60 then
        return "now"
    elseif seconds < 3600 then
        local mins = math.floor(seconds / 60)
        return string.format("%dm ago", mins)
    elseif seconds < 86400 then
        local hours = math.floor(seconds / 3600)
        return string.format("%dh ago", hours)
    else
        local days = math.floor(seconds / 86400)
        return string.format("%dd ago", days)
    end
end

--- Safe JSON decode with pcall wrapper
-- @param str string JSON string to decode
-- @return table|nil Decoded table or nil if parsing fails
function M.safe_json_decode(str)
    if not str or str == "" then return nil end
    local ok, result = pcall(hs.json.decode, str)
    if ok then
        return result
    else
        return nil
    end
end

--- Escape string for HTML display
-- @param str string String to escape
-- @return string HTML-escaped string
function M.escape_html(str)
    if not str then return "" end
    local replacements = {
        ["&"] = "&amp;",
        ["<"] = "&lt;",
        [">"] = "&gt;",
        ['"'] = "&quot;",
        ["'"] = "&#39;",
    }
    return (str:gsub("[&<>\"']", replacements))
end

--- Truncate string to max length with ellipsis
-- @param str string String to truncate
-- @param max_length number Maximum length
-- @return string Truncated string
function M.truncate(str, max_length)
    if not str then return "" end
    max_length = max_length or 50
    if #str <= max_length then
        return str
    end
    return str:sub(1, max_length - 3) .. "..."
end

--- Clean whitespace from string
-- @param str string String to clean
-- @return string Cleaned string
function M.clean_whitespace(str)
    if not str then return "" end
    -- Replace newlines and multiple spaces with single space
    return str:gsub("\n", " "):gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
end

return M
