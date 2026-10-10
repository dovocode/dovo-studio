import { Button } from '@dovo/studio-ui'
import { useEffect, useState } from 'react'
import { useStudioHost } from '@dovo/studio-core'
import type { DesktopUpdateState } from '@dovo/protocol'
import { SettingRow, SettingsGroup } from './layout'
import { SettingsSelect } from './settings-select'
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
  const statusLabels: Record<DesktopUpdateState['status'], string> = {
    idle: 'Check for the latest version.',
    available: 'Update available.',
    downloading: 'Downloading update…',
    downloaded: 'Update ready. Restart Dovo to install it.',
    restarting: 'Restarting Dovo…',
    error: 'Could not check for updates. Try again.',
  }
  const description =
    appInfo?.channel === 'dev'
      ? 'Development builds do not receive automatic application updates.'
      : !state
        ? error
          ? 'Update status unavailable.'
          : 'Loading update status…'
        : `${state.version ? `Version ${state.version} · ` : ''}${statusLabels[state.status]}`
  return (
    <SettingsGroup title="Application updates">
      <SettingRow label="Update status" description={<span role="status">{description}</span>}>
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
          {state?.status === 'restarting' || (busy && state?.status === 'downloaded')
            ? 'Restarting…'
            : state?.status === 'downloading'
              ? 'Downloading…'
              : busy
                ? 'Checking…'
                : state?.status === 'downloaded'
                  ? 'Restart to update'
                  : 'Check for updates'}
        </Button>
      </SettingRow>
      <SettingRow
        label="Release channel"
        description="Stable is recommended. Nightly includes newer changes and may be less stable. Uses this build’s channel until you choose another."
      >
        <SettingsSelect
          label="Release channel"
          value={state?.channel ?? (appInfo?.channel === 'nightly' ? 'nightly' : 'stable')}
          options={[
            ['stable', 'Stable'],
            ['nightly', 'Nightly'],
          ]}
          disabled={
            !state ||
            busy ||
            appInfo?.channel === 'dev' ||
            ['downloading', 'downloaded', 'restarting'].includes(state.status)
          }
          onChange={(channel) => {
            setBusy(true)
            setError('')
            void updates
              .setChannel(channel)
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : String(cause)),
              )
              .finally(() => setBusy(false))
          }}
        />
      </SettingRow>
      {(error || state?.error) && (
        <p role="alert" className="px-4 py-3 text-xs text-destructive">
          {error || state?.error}
        </p>
      )}
    </SettingsGroup>
  )
}
