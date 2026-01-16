-- panel.lua
-- WebView panel management for Claude Session Tracker

local M = {}
local config = require("claude-tracker.config").config
local html = require("claude-tracker.html")
local tmux = require("claude-tracker.tmux")

-- Panel state
M.webview = nil
M.userContent = nil
M.timer = nil
M.visible = false
M.sessions = {}

-- Settings key for persisting window position
local POSITION_KEY = "claude-tracker.panel.position"

--- Load saved window position or return defaults from config
local function load_position()
    local saved = hs.settings.get(POSITION_KEY)
    if saved and saved.x and saved.y and saved.w and saved.h then
        return saved
    end
    return {
        x = config.panel.x,
        y = config.panel.y,
        w = config.panel.width,
        h = config.panel.height,
    }
end

--- Save current window position
local function save_position(frame)
    hs.settings.set(POSITION_KEY, {
        x = frame.x,
        y = frame.y,
        w = frame.w,
        h = frame.h,
    })
end

-- Callback for refreshing data (set by init.lua)
M.refresh_callback = nil

--- Create the WebView panel
-- @return hs.webview The created WebView object
function M.create()
    if M.webview then
        return M.webview
    end

    -- Load saved position or use defaults
    local frame = load_position()

    -- Create user content controller for JavaScript callbacks
    M.userContent = hs.webview.usercontent.new("hammerspoon")
    M.userContent:setCallback(function(message)
        print("[claude-tracker:panel] JS message received: " .. hs.inspect(message))
        local body = message.body
        if type(body) == "table" then
            local action = body.action
            local session = body.session

            if action == "focus" and session then
                session = session:gsub("%%20", " "):gsub("%%3A", ":")
                hs.timer.doAfter(0, function()
                    M.focus_session(session)
                end)
            elseif action == "open" and session then
                session = session:gsub("%%20", " "):gsub("%%3A", ":")
                hs.timer.doAfter(0, function()
                    M.open_in_vscode(session)
                end)
            elseif action == "refresh" then
                hs.timer.doAfter(0, function()
                    M.refresh()
                end)
            end
        end
    end)

    M.webview = hs.webview.new(frame, {developerExtrasEnabled = true}, M.userContent)

    -- Window styling - floating HUD style
    M.webview:windowStyle({"utility", "HUD", "titled"})
    M.webview:level(hs.drawing.windowLevels.floating)
    M.webview:allowTextEntry(false)
    M.webview:allowMagnificationGestures(false)
    M.webview:allowNewWindows(false)
    M.webview:windowTitle("Claude Sessions")

    -- Save position when window is moved or resized
    M.webview:windowCallback(function(action, webview, state)
        if action == "frameChange" and M.webview then
            local newFrame = M.webview:frame()
            if newFrame then
                save_position(newFrame)
            end
        end
    end)

    return M.webview
end

--- Focus a tmux session
-- @param session_name string The tmux session name to focus
function M.focus_session(session_name)
    tmux.focus_session(session_name, "claude")
end

--- Open a session's path in VSCode
-- @param session_name string The tmux session name to look up
function M.open_in_vscode(session_name)
    print("[claude-tracker:panel] open_in_vscode called with: " .. tostring(session_name))
    print("[claude-tracker:panel] Number of stored sessions: " .. #M.sessions)

    -- Find the session's path from stored sessions
    local path = nil
    for _, session in ipairs(M.sessions) do
        print("[claude-tracker:panel] Checking session: " .. tostring(session.tmux_session))
        if session.tmux_session == session_name then
            path = session.tmux_path
            break
        end
    end

    if path then
        print("[claude-tracker:panel] Found path: " .. path)
        -- Use hs.task for more reliable execution
        local task = hs.task.new("/usr/local/bin/code", function(exitCode, stdOut, stdErr)
            print("[claude-tracker:panel] VSCode task completed. Exit: " .. tostring(exitCode))
            if stdErr and stdErr ~= "" then
                print("[claude-tracker:panel] stderr: " .. stdErr)
            end
        end, {path})
        task:start()
        -- Also focus VSCode (must use full name)
        hs.application.launchOrFocus("Visual Studio Code")
    else
        print("[claude-tracker:panel] Could not find path for session: " .. session_name)
        hs.alert.show("Could not find path for: " .. session_name, 2)
    end
end

--- Update panel with current session data
function M.refresh()
    -- Call the refresh callback to gather fresh data
    if M.refresh_callback then
        M.sessions = M.refresh_callback()
    end

    print("[claude-tracker:panel] Sessions count: " .. #M.sessions)

    -- Generate and set HTML content
    if M.webview then
        local html_content = html.generate_html(M.sessions, config)
        print("[claude-tracker:panel] HTML length: " .. #html_content)
        M.webview:html(html_content)
    else
        print("[claude-tracker:panel] ERROR: webview is nil")
    end
end

--- Toggle panel visibility
function M.toggle()
    if not M.webview then
        M.create()
    end

    if M.visible then
        M.hide()
    else
        M.show()
    end
end

--- Show the panel
function M.show()
    if not M.webview then
        M.create()
    end

    M.refresh()
    M.webview:show()
    M.visible = true
    M.start_timer()
end

--- Hide the panel
function M.hide()
    if M.webview then
        M.webview:hide()
    end
    M.visible = false
    M.stop_timer()
end

--- Start the auto-refresh timer
function M.start_timer()
    if M.timer then
        return  -- Already running
    end

    M.timer = hs.timer.doEvery(config.refresh_interval, function()
        if M.visible then
            M.refresh()
        end
    end)
end

--- Stop the auto-refresh timer
function M.stop_timer()
    if M.timer then
        M.timer:stop()
        M.timer = nil
    end
end

--- Check if panel is currently visible
-- @return boolean True if panel is visible
function M.is_visible()
    return M.visible
end

--- Destroy the panel and clean up resources
function M.destroy()
    M.stop_timer()
    if M.webview then
        M.webview:delete()
        M.webview = nil
    end
    M.visible = false
    M.sessions = {}
end

return M
