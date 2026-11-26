import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { RuntimeSpeechSettings } from './runtime-speech'
import { useEffect, useState } from 'react'
import {
  decode,
  desktopDictationBridge,
  dictationDownloadProgress,
  dictationLanguages,
  dictationLanguageSchema,
  dictationModel,
  dictationProviderSchema,
  dictationStatusSchema,
  botVoicePauseOptions,
  botVoicePauseSchema,
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
  const uiText = useInterfaceText()

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

  const pause = (
    <SettingsGroup
      title="Bot voice calls"
      description="Saved on this device. Choose how long you can pause before sending a spoken message."
    >
      <SettingRow label="Voice pause">
        <SettingsSelect
          label="Voice pause"
          value={String(preferences.botVoicePause)}
          options={botVoicePauseOptions.map((ms) => [String(ms), `${ms / 1000} seconds`] as const)}
          onChange={(value) =>
            updateAppPreferences({ botVoicePause: decode(botVoicePauseSchema, Number(value)) })
          }
        />
      </SettingRow>
    </SettingsGroup>
  )
  if (!bridge)
    return (
      <>
        {pause}
        <RuntimeSpeechSettings />
      </>
    )
  const downloading = installing || status?.downloading
  const apple = preferences.dictationProvider === 'apple'
  const ready = apple ? status?.appleSpeech : status?.model
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
    <>
      {pause}
      <RuntimeSpeechSettings />
      <SettingsGroup
        title={uiText('Speech')}
        description="Dictate messages with live preview. Speech is processed on this computer, including when connected to a remote runtime."
      >
        {(status?.appleSpeech || apple) && (
          <SettingRow
            label="Speech engine"
            description={
              apple
                ? 'Apple Speech runs on this Mac. Apple may download language assets the first time you dictate.'
                : undefined
            }
          >
            <SettingsSelect
              label="Speech engine"
              value={preferences.dictationProvider}
              options={
                status?.appleSpeech
                  ? [
                      ['nemotron', dictationModel.name],
                      ['apple', 'Apple Speech'],
                    ]
                  : [
                      ['nemotron', dictationModel.name],
                      ['apple', 'Apple Speech (unavailable)'],
                    ]
              }
              disabled={!!downloading}
              onChange={(value) =>
                updateAppPreferences({
                  dictationProvider: decode(dictationProviderSchema, value),
                })
              }
            />
          </SettingRow>
        )}
        <SettingRow
          label="Enable dictation"
          description="Show the microphone in the message composer."
        >
          <Toggle
            label="Enable dictation"
            checked={preferences.dictationEnabled}
            disabled={(!ready && !preferences.dictationEnabled) || !!downloading}
            onChange={(dictationEnabled) => updateAppPreferences({ dictationEnabled })}
          />
        </SettingRow>
        {!apple && (
          <SettingRow
            label="Speech model"
            description={`${dictationModel.name} · Q8 · 751 MB download. Works offline after downloading. No account or GPU required.`}
          >
            <div className="flex flex-col items-end gap-2">
              {downloading ? (
                <>
                  <span role="status" className="text-xs text-muted-foreground">
                    Downloading… {dictationDownloadProgress(status?.downloaded ?? 0)}%
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
                  <Button
                    variant="outline"
                    disabled={!status?.engine}
                    onClick={() => void install()}
                  >
                    {status?.model ? 'Download model again' : 'Download & enable dictation'}
                  </Button>
                </>
              )}
            </div>
          </SettingRow>
        )}
        <SettingRow
          label="Dictation language"
          description={
            apple
              ? 'Choose a language or use the Mac’s preferred language.'
              : 'Select a language to guide recognition, or detect it automatically.'
          }
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
        {status && !(apple ? status.appleSpeech : status.engine) && (
          <p role="alert" className="text-sm text-destructive">
            {apple
              ? 'Apple Speech is unavailable on this Mac. Select Nemotron to use desktop dictation.'
              : 'The dictation engine is missing. Reinstall the desktop app, or run pnpm prepare:dictation in a development checkout.'}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </SettingsGroup>
    </>
  )
}
