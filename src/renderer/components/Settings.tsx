import { useState, useEffect, useCallback } from "react"

// Types matching the preload API
type LlmProvider = "none" | "anthropic" | "openai" | "ollama" | "lmstudio"

interface LlmSettings {
  provider: LlmProvider
  model: string
  apiKey?: string
  baseUrl?: string
}

interface DisplaySettings {
  cardSize?: "regular" | "compact"
  sortBy?: "recent" | "status" | "name" | "context"
  hiddenSessions?: string[]
  showHidden?: boolean
  opacity?: number
}

type StatusSource = "tmux" | "jsonl" | "hybrid"

interface AppSettings {
  llm: LlmSettings
  session: {
    sessionPattern: string
    maxSessionAgeHours: number
    pollIntervalMs: number
    editorCommand?: string
    statusSource?: StatusSource
  }
  display?: DisplaySettings
}

interface ProviderPreset {
  name: string
  provider: LlmProvider
  baseUrl: string
  requiresApiKey: boolean
  defaultModel: string
  availableModels: string[]
}

interface SettingsProps {
  isOpen: boolean
  onClose: () => void
}

interface TestResult {
  success: boolean
  message: string
  model?: string
  responseTime?: number
}

export function Settings({ isOpen, onClose }: SettingsProps): JSX.Element | null {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [presets, setPresets] = useState<Record<string, ProviderPreset>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  // Load settings and presets on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [loadedSettings, loadedPresets] = await Promise.all([
          window.api.getSettings(),
          window.api.getProviderPresets()
        ])
        setSettings(loadedSettings as AppSettings)
        setPresets(loadedPresets as Record<string, ProviderPreset>)
      } catch (err) {
        setError("Failed to load settings")
        console.error(err)
      }
    }
    void loadData()
  }, [])

  // Handle provider change
  const handleProviderChange = useCallback((provider: LlmProvider) => {
    if (!settings) return

    const preset = presets[provider]
    if (preset) {
      const newLlm: LlmSettings = {
        provider,
        model: preset.defaultModel,
        baseUrl: preset.baseUrl
      }
      if (preset.requiresApiKey && settings.llm.apiKey) {
        newLlm.apiKey = settings.llm.apiKey
      }
      setSettings({
        ...settings,
        llm: newLlm
      })
    }
  }, [settings, presets])

  // Handle model change
  const handleModelChange = useCallback((model: string) => {
    if (!settings) return
    setSettings({
      ...settings,
      llm: { ...settings.llm, model }
    })
  }, [settings])

  // Handle API key change
  const handleApiKeyChange = useCallback((apiKey: string) => {
    if (!settings) return
    const newLlm: LlmSettings = {
      provider: settings.llm.provider,
      model: settings.llm.model
    }
    if (settings.llm.baseUrl) {
      newLlm.baseUrl = settings.llm.baseUrl
    }
    if (apiKey) {
      newLlm.apiKey = apiKey
    }
    setSettings({
      ...settings,
      llm: newLlm
    })
  }, [settings])

  // Handle base URL change
  const handleBaseUrlChange = useCallback((baseUrl: string) => {
    if (!settings) return
    const newLlm: LlmSettings = {
      provider: settings.llm.provider,
      model: settings.llm.model
    }
    if (settings.llm.apiKey) {
      newLlm.apiKey = settings.llm.apiKey
    }
    if (baseUrl) {
      newLlm.baseUrl = baseUrl
    }
    setSettings({
      ...settings,
      llm: newLlm
    })
  }, [settings])

  // Handle session pattern change
  const handlePatternChange = useCallback((sessionPattern: string) => {
    if (!settings) return
    setSettings({
      ...settings,
      session: { ...settings.session, sessionPattern }
    })
  }, [settings])

  // Handle editor command change
  const handleEditorChange = useCallback((editorCommand: string) => {
    if (!settings) return
    const newSession = {
      sessionPattern: settings.session.sessionPattern,
      maxSessionAgeHours: settings.session.maxSessionAgeHours,
      pollIntervalMs: settings.session.pollIntervalMs
    } as typeof settings.session
    if (editorCommand) {
      newSession.editorCommand = editorCommand
    }
    setSettings({
      ...settings,
      session: newSession
    })
  }, [settings])

  // Handle status source change
  const handleStatusSourceChange = useCallback((statusSource: StatusSource) => {
    if (!settings) return
    setSettings({
      ...settings,
      session: { ...settings.session, statusSource }
    })
  }, [settings])

  // Handle card size change
  const handleCardSizeChange = useCallback((cardSize: "regular" | "compact") => {
    if (!settings) return
    setSettings({
      ...settings,
      display: { ...settings.display, cardSize }
    })
  }, [settings])

  // Handle sort by change
  const handleSortByChange = useCallback((sortBy: "recent" | "status" | "name" | "context") => {
    if (!settings) return
    setSettings({
      ...settings,
      display: { ...settings.display, sortBy }
    })
  }, [settings])

  // Handle opacity change
  const handleOpacityChange = useCallback((opacity: number) => {
    if (!settings) return
    setSettings({
      ...settings,
      display: { ...settings.display, opacity }
    })
    // Apply immediately for preview
    void window.api.setWindowOpacity(opacity)
  }, [settings])

  // Test LLM connection
  const handleTestConnection = useCallback(async () => {
    if (!settings) return

    setIsTesting(true)
    setTestResult(null)

    try {
      const result = await window.api.testLlmConnection(settings.llm)
      setTestResult(result)
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : "Test failed"
      })
    } finally {
      setIsTesting(false)
    }
  }, [settings])

  // Save settings
  const handleSave = useCallback(async () => {
    if (!settings) return

    setIsSaving(true)
    setError(null)

    try {
      await window.api.saveSettings(settings)
      onClose()
    } catch (err) {
      setError("Failed to save settings")
      console.error(err)
    } finally {
      setIsSaving(false)
    }
  }, [settings, onClose])

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const currentPreset = settings ? presets[settings.llm.provider] : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
            aria-label="Close settings"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6">
          {error && (
            <div className="bg-red-500/20 border border-red-500/50 rounded p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          {settings && (
            <>
              {/* LLM Progress Summary Section */}
              <section>
                <h3 className="text-sm font-medium text-gray-300 mb-3">LLM Progress Summary</h3>

                {/* Provider Selection */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {Object.values(presets).map((preset) => (
                    <button
                      key={preset.provider}
                      onClick={() => handleProviderChange(preset.provider)}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        settings.llm.provider === preset.provider
                          ? "bg-blue-600/20 border-blue-500 text-blue-400"
                          : "bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600"
                      }`}
                    >
                      <div className="font-medium text-sm">{preset.name}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {preset.requiresApiKey ? "API key required" : "Local"}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Model Selection */}
                <div className="mb-4">
                  <label className="block text-sm text-gray-400 mb-1">Model</label>
                  {currentPreset && currentPreset.availableModels.length > 0 ? (
                    <select
                      value={settings.llm.model}
                      onChange={(e) => handleModelChange(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                    >
                      {currentPreset.availableModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={settings.llm.model}
                      onChange={(e) => handleModelChange(e.target.value)}
                      placeholder="Enter model name"
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                  )}
                </div>

                {/* API Key (for cloud providers) */}
                {currentPreset?.requiresApiKey && (
                  <div className="mb-4">
                    <label className="block text-sm text-gray-400 mb-1">API Key</label>
                    <input
                      type="password"
                      value={settings.llm.apiKey ?? ""}
                      onChange={(e) => handleApiKeyChange(e.target.value)}
                      placeholder="Enter API key"
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Stored locally, never sent to our servers
                    </p>
                  </div>
                )}

                {/* Base URL (for local providers) */}
                {!currentPreset?.requiresApiKey && (
                  <div className="mb-4">
                    <label className="block text-sm text-gray-400 mb-1">Base URL</label>
                    <input
                      type="text"
                      value={settings.llm.baseUrl ?? currentPreset?.baseUrl ?? ""}
                      onChange={(e) => handleBaseUrlChange(e.target.value)}
                      placeholder="http://localhost:1234/v1"
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}

                {/* Test Connection Button */}
                {settings.llm.provider !== "none" && (
                  <div className="mb-4">
                    <button
                      onClick={() => void handleTestConnection()}
                      disabled={isTesting}
                      className="px-4 py-2 text-sm bg-gray-700 text-gray-300 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isTesting ? "Testing..." : "Test Connection"}
                    </button>

                    {/* Test Result */}
                    {testResult && (
                      <div className={`mt-2 p-2 rounded text-sm ${
                        testResult.success
                          ? "bg-green-500/20 border border-green-500/50 text-green-400"
                          : "bg-red-500/20 border border-red-500/50 text-red-400"
                      }`}>
                        <div className="font-medium">
                          {testResult.success ? "✓ " : "✗ "}{testResult.message}
                        </div>
                        {testResult.success && testResult.responseTime && (
                          <div className="text-xs mt-1 opacity-75">
                            Model: {testResult.model} • Response: {testResult.responseTime}ms
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Status Detection Section */}
              <section>
                <h3 className="text-sm font-medium text-gray-300 mb-3">Status Detection</h3>

                <div className="space-y-2">
                  <label
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      (settings.session.statusSource ?? "hybrid") === "hybrid"
                        ? "bg-blue-600/20 border-blue-500"
                        : "bg-gray-700 border-gray-600 hover:bg-gray-600"
                    }`}
                    onClick={() => handleStatusSourceChange("hybrid")}
                  >
                    <input
                      type="radio"
                      name="statusSource"
                      checked={(settings.session.statusSource ?? "hybrid") === "hybrid"}
                      onChange={() => handleStatusSourceChange("hybrid")}
                      className="mt-1"
                    />
                    <div>
                      <div className="text-sm font-medium text-white">Hybrid (Recommended)</div>
                      <div className="text-xs text-gray-400 mt-0.5">Pane for status, JSONL + LLM for summaries</div>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      settings.session.statusSource === "tmux"
                        ? "bg-blue-600/20 border-blue-500"
                        : "bg-gray-700 border-gray-600 hover:bg-gray-600"
                    }`}
                    onClick={() => handleStatusSourceChange("tmux")}
                  >
                    <input
                      type="radio"
                      name="statusSource"
                      checked={settings.session.statusSource === "tmux"}
                      onChange={() => handleStatusSourceChange("tmux")}
                      className="mt-1"
                    />
                    <div>
                      <div className="text-sm font-medium text-white">Tmux Only</div>
                      <div className="text-xs text-gray-400 mt-0.5">Status only, no metadata (fastest)</div>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      settings.session.statusSource === "jsonl"
                        ? "bg-blue-600/20 border-blue-500"
                        : "bg-gray-700 border-gray-600 hover:bg-gray-600"
                    }`}
                    onClick={() => handleStatusSourceChange("jsonl")}
                  >
                    <input
                      type="radio"
                      name="statusSource"
                      checked={settings.session.statusSource === "jsonl"}
                      onChange={() => handleStatusSourceChange("jsonl")}
                      className="mt-1"
                    />
                    <div>
                      <div className="text-sm font-medium text-white">JSONL (Legacy)</div>
                      <div className="text-xs text-gray-400 mt-0.5">Full parsing, enables LLM summaries</div>
                    </div>
                  </label>
                </div>
              </section>

              {/* Session Matching Section */}
              <section>
                <h3 className="text-sm font-medium text-gray-300 mb-3">Session Matching</h3>

                <div className="mb-4">
                  <label className="block text-sm text-gray-400 mb-1">Session Pattern (regex)</label>
                  <input
                    type="text"
                    value={settings.session.sessionPattern}
                    onChange={(e) => handlePatternChange(e.target.value)}
                    placeholder=".*"
                    className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Only tmux sessions matching this pattern will be tracked.
                    Use &quot;.*&quot; to track all sessions.
                  </p>
                </div>
              </section>

              {/* Editor Section */}
              <section>
                <h3 className="text-sm font-medium text-gray-300 mb-3">Editor</h3>

                <div className="mb-4">
                  <label className="block text-sm text-gray-400 mb-1">Editor</label>
                  <select
                    value={settings.session.editorCommand ?? "code"}
                    onChange={(e) => handleEditorChange(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="code">Visual Studio Code</option>
                    <option value="cursor">Cursor</option>
                    <option value="zed">Zed</option>
                    <option value="sublime">Sublime Text</option>
                    <option value="webstorm">WebStorm</option>
                    <option value="idea">IntelliJ IDEA</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Opens when clicking a session (single-click).
                    Double-click focuses the terminal.
                  </p>
                </div>
              </section>

              {/* Display Section */}
              <section>
                <h3 className="text-sm font-medium text-gray-300 mb-3">Display</h3>

                <div className="mb-4">
                  <label className="block text-sm text-gray-400 mb-1">Card Size</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCardSizeChange("regular")}
                      className={`flex-1 py-2 px-3 rounded text-sm transition-colors ${
                        (settings.display?.cardSize ?? "regular") === "regular"
                          ? "bg-blue-600/20 border border-blue-500 text-blue-400"
                          : "bg-gray-700 border border-gray-600 text-gray-300 hover:bg-gray-600"
                      }`}
                    >
                      Regular
                    </button>
                    <button
                      onClick={() => handleCardSizeChange("compact")}
                      className={`flex-1 py-2 px-3 rounded text-sm transition-colors ${
                        settings.display?.cardSize === "compact"
                          ? "bg-blue-600/20 border border-blue-500 text-blue-400"
                          : "bg-gray-700 border border-gray-600 text-gray-300 hover:bg-gray-600"
                      }`}
                    >
                      Compact
                    </button>
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-sm text-gray-400 mb-1">Sort By</label>
                  <select
                    value={settings.display?.sortBy ?? "recent"}
                    onChange={(e) => handleSortByChange(e.target.value as "recent" | "status" | "name" | "context")}
                    className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="recent">Recent Activity</option>
                    <option value="status">Status (Needs Attention First)</option>
                    <option value="name">Name (A-Z)</option>
                    <option value="context">Context Usage (High to Low)</option>
                  </select>
                </div>

                <div className="mb-4">
                  <label className="block text-sm text-gray-400 mb-1">
                    Window Transparency: {Math.round((settings.display?.opacity ?? 1.0) * 100)}%
                  </label>
                  <input
                    type="range"
                    min="30"
                    max="100"
                    value={Math.round((settings.display?.opacity ?? 1.0) * 100)}
                    onChange={(e) => handleOpacityChange(Number(e.target.value) / 100)}
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>30%</span>
                    <span>100%</span>
                  </div>
                </div>
              </section>

            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={isSaving || !settings}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}
