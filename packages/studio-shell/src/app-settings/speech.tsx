import { useEffect, useState } from 'react'
import {
  decode,
  desktopDictationBridge,
  dictationLanguages,
  dictationLanguageSchema,
  dictationModel,
  dictationStatusSchema,
  randomUUID,
  type DictationStatus,
} from '@dovo/protocol'
import { updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { SettingRow, SettingsGroup, Toggle } from './layout'
import { SettingsSelect } from './settings-select'

// Retain ownership when navigating away from Settings and returning during a download.
const downloadId = randomUUID()
let downloadInFlight: Promise<void> | undefined

export function SpeechSettings() {
  const bridge = desktopDictationBridge()
  const preferences = useAppPreferences()
  const [status, setStatus] = useState<DictationStatus | null>(null)
  const [error, setError] = useState('')
  const [installing, setInstalling] = useState(false)
  useEffect(() => {
    if (!bridge) return
    let live = true
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const value = decode(dictationStatusSchema, await bridge.status())
        if (live) setStatus(value)
      } catch (cause) {
        if (live) setError(String(cause))
      } finally {
        if (live) timer = setTimeout(() => void refresh(), 500)
      }
    }
    void refresh()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [bridge])

  if (!bridge) return null
  const downloading = installing || status?.downloading
  const install = async () => {
    setError('')
    setInstalling(true)
    try {
      downloadInFlight = bridge.install(downloadId)
      await downloadInFlight
      setStatus(decode(dictationStatusSchema, await bridge.status()))
      updateAppPreferences({ dictationEnabled: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      downloadInFlight = undefined
      setInstalling(false)
    }
  }
  return (
    <SettingsGroup
      title="Speech"
      description="Dictate messages with live preview. Speech is processed on this computer, including when connected to a remote runtime."
    >
      <SettingRow
        label="Enable dictation"
        description="Show the microphone in the message composer."
      >
        <Toggle
          label="Enable dictation"
          checked={preferences.dictationEnabled}
          disabled={!status?.model || !!downloading}
          onChange={(dictationEnabled) => updateAppPreferences({ dictationEnabled })}
        />
      </SettingRow>
      <SettingRow
        label="Speech model"
        description={`${dictationModel.name} · Q8 · 751 MB download. Works offline after downloading. No account or GPU required.`}
      >
        <div className="flex flex-col items-end gap-2">
          {downloading ? (
            <>
              <span role="status" className="text-xs text-muted-foreground">
                Downloading…{' '}
                {Math.min(
                  100,
                  Math.floor(((status?.downloaded ?? 0) / dictationModel.bytes) * 100),
                )}
                %
              </span>
              {downloadInFlight && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void bridge
                      .cancel(downloadId)
                      .catch((cause: unknown) => setError(String(cause)))
                  }}
                >
                  Cancel download
                </Button>
              )}
            </>
          ) : (
            <>
              {status?.model && (
                <span role="status" className="text-xs text-muted-foreground">
                  Downloaded · ready for offline dictation
                </span>
              )}
              <Button variant="outline" disabled={!status?.engine} onClick={() => void install()}>
                {status?.model ? 'Download model again' : 'Download & enable dictation'}
              </Button>
            </>
          )}
        </div>
      </SettingRow>
      <SettingRow
        label="Dictation language"
        description="Select a language to guide recognition, or detect it automatically."
      >
        <SettingsSelect
          label="Dictation language"
          value={preferences.dictationLanguage}
          options={dictationLanguages}
          onChange={(value) =>
            updateAppPreferences({ dictationLanguage: decode(dictationLanguageSchema, value) })
          }
        />
      </SettingRow>
      {status && !status.engine && (
        <p role="alert" className="text-sm text-destructive">
          The dictation engine is missing. Reinstall the desktop app, or run pnpm prepare:dictation
          in a development checkout.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </SettingsGroup>
  )
}
