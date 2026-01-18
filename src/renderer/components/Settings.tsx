import { useState, useEffect, useCallback } from "react"

// Types matching the preload API
type LlmProvider = "none" | "anthropic" | "openai" | "ollama" | "lmstudio"

interface LlmSettings {
  provider: LlmProvider
  model: string
  apiKey?: string
  baseUrl?: string
}

interface AppSettings {
  llm: LlmSettings
  session: {
    sessionPattern: string
    maxSessionAgeHours: number
    pollIntervalMs: number
    editorCommand?: string
  }
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

export function Settings({ isOpen, onClose }: SettingsProps): JSX.Element | null {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [presets, setPresets] = useState<Record<string, ProviderPreset>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
                  <label className="block text-sm text-gray-400 mb-1">Editor Command</label>
                  <input
                    type="text"
                    value={settings.session.editorCommand ?? "code"}
                    onChange={(e) => handleEditorChange(e.target.value)}
                    placeholder="code"
                    className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Command to open when double-clicking a session.
                    Examples: code, cursor, zed, nvim
                  </p>
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
