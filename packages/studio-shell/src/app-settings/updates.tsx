import { Button } from '@dovo/studio-ui'
import { useEffect, useState } from 'react'
import { useStudioHost } from '@dovo/studio-core'
import type { DesktopUpdateState } from '@dovo/protocol'
import { SettingRow, SettingsGroup } from './layout'
export function UpdateSettings() {
  const { updates, appInfo } = useStudioHost()
  const [state, setState] = useState<DesktopUpdateState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!updates) return
    let live = true
    let received = false
    const unsubscribe = updates.subscribe((value) => {
      received = true
      if (live) setState(value)
    })
    void updates
      .state()
      .then((value) => {
        if (live && !received) setState(value)
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      live = false
      unsubscribe()
    }
  }, [updates])
  if (!updates) return null
  return (
    <SettingsGroup title="Updates">
      <SettingRow
        label="Application updates"
        description={
          state?.error ||
          (state?.version
            ? `Version ${state.version} · ${state.status}`
            : state?.status === 'idle'
              ? 'Check for the latest version.'
              : state?.status)
        }
      >
        <Button
          variant="outline"
          disabled={
            !state ||
            busy ||
            appInfo?.channel === 'dev' ||
            state.status === 'downloading' ||
            state.status === 'restarting'
          }
          onClick={() => {
            setBusy(true)
            setError('')
            void (state?.status === 'downloaded' ? updates.install() : updates.check())
              .catch((cause) => setError(String(cause)))
              .finally(() => setBusy(false))
          }}
        >
          {busy
            ? 'Checking…'
            : state?.status === 'downloaded'
              ? 'Restart to update'
              : 'Check for updates'}
        </Button>
      </SettingRow>
      <SettingRow
        label="Release channel"
        description="Defaults to this build’s channel. Changes are saved only when you choose a channel here. Nightly includes the newest changes and may be less stable."
      >
        <select
          aria-label="Release channel"
          className="min-w-32 rounded-md border bg-background p-2 text-xs"
          value={state?.channel ?? (appInfo?.channel === 'nightly' ? 'nightly' : 'stable')}
          disabled={
            !state ||
            busy ||
            appInfo?.channel === 'dev' ||
            ['downloading', 'downloaded', 'restarting'].includes(state.status)
          }
          onChange={(event) => {
            const channel = event.target.value
            if (channel !== 'stable' && channel !== 'nightly') return
            setBusy(true)
            setError('')
            void updates
              .setChannel(channel)
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              )
              .finally(() => setBusy(false))
          }}
        >
          <option value="stable">Stable</option>
          <option value="nightly">Nightly</option>
        </select>
      </SettingRow>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </SettingsGroup>
  )
}
