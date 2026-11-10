import { useEffect, useState } from 'react'
import { dictationStatusSchema, randomUUID, responses, type DictationStatus } from '@dovo/protocol'
import { useWorkspace, useAppPreferences, updateAppPreferences } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { SettingRow, SettingsGroup, Toggle } from './layout'

export function RuntimeSpeechSettings() {
  const { connection, snapshot } = useWorkspace()
  return (
    <ComputerSpeechSettings
      key={JSON.stringify([snapshot?.runtimeId, connection?.address, connection?.token])}
    />
  )
}
function ComputerSpeechSettings() {
  const { request, connected, snapshot } = useWorkspace()
  const preferences = useAppPreferences()
  const [status, setStatus] = useState<DictationStatus>()
  const [error, setError] = useState('')
  const [statusError, setStatusError] = useState('')
  const [operation, setOperation] = useState('')
  const runtimeId = snapshot?.runtimeId
  useEffect(() => {
    if (!connected || !snapshot?.runtimeDictationSupported) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const result = await request('/api/dictation/status', {}, dictationStatusSchema)
        if (!stopped) {
          setStatus(result)
          setStatusError('')
        }
      } catch (cause) {
        if (!stopped) setStatusError(String(cause))
      } finally {
        if (!stopped) timer = setTimeout(refresh, 1000)
      }
    }
    void refresh()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [request, connected, runtimeId, snapshot?.runtimeDictationSupported, operation])
  if (!snapshot?.runtimeDictationSupported || !runtimeId) return null
  return (
    <SettingsGroup
      title="Dictation on the selected computer"
      description="Opt in on this device to send finished recordings to the current thread’s computer. Audio stays on that computer. This does not enable other devices."
    >
      <SettingRow
        label="Use this computer for dictation"
        description="The thread’s computer transcribes the recording. Other computers need their own opt-in."
      >
        <Toggle
          label="Use this computer for dictation"
          checked={preferences.runtimeDictationIds.includes(runtimeId)}
          disabled={
            !preferences.runtimeDictationIds.includes(runtimeId) && (!connected || !status?.model)
          }
          onChange={(enabled) =>
            updateAppPreferences({
              runtimeDictationIds: [
                ...preferences.runtimeDictationIds.filter((id) => id !== runtimeId),
                ...(enabled ? [runtimeId] : []),
              ],
            })
          }
        />
      </SettingRow>
      <SettingRow
        label="Computer speech model"
        description="751 MB. Install once on the selected computer. Phone recordings also need FFmpeg on that computer."
      >
        <div className="space-y-2 text-xs">
          {status?.downloading && (
            <p role="status">Downloading… {Math.floor((status.downloaded / 751094240) * 100)}%</p>
          )}
          {status?.model && <p>Downloaded</p>}
          {!status?.engine && (
            <p>
              Install the speech engine on this computer with pnpm prepare:dictation, or update its
              server package.
            </p>
          )}
          <Button
            size="sm"
            disabled={!connected || !status?.engine || !!operation || status.downloading}
            onClick={async () => {
              const id = randomUUID()
              setOperation(id)
              setError('')
              try {
                setStatus(await request('/api/dictation/install', { id }, dictationStatusSchema))
              } catch (cause) {
                setError(String(cause))
              } finally {
                setOperation('')
              }
            }}
          >
            {status?.model ? 'Download model again' : 'Download model on computer'}
          </Button>
          {operation && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void request('/api/dictation/cancel', { id: operation }, responses.ok).catch(
                  (cause: unknown) => setError(String(cause)),
                )
              }
            >
              Cancel download
            </Button>
          )}
          {(error || statusError) && <p role="alert">{error || statusError}</p>}
        </div>
      </SettingRow>
    </SettingsGroup>
  )
}
