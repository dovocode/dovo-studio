import { SettingsPage, SettingsStorageInfo } from './settings-layout'
import { useEffect, useRef, type ReactNode } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  useConfirmSettingsNavigation,
  useOptionalSettingsTarget,
  useRuntimeSources,
  useWorkspace,
  WorkspaceScope,
} from '@dovo/studio-core'
import { ChoicePicker } from './choice-picker'
import { Button } from './components/ui/button'

/** A settings page for one computer, with a picker like Codex's host selector. Pages list
 * every saved computer; a linked host takes precedence over the active one. */
export function HostSettingsPage({
  title,
  description,
  initialRuntimeId,
  children,
  localSettings,
  saveInfo,
}: {
  title: string
  description: string
  initialRuntimeId?: string
  children: ReactNode
  localSettings?: ReactNode
  saveInfo?: string
}) {
  const sources = useRuntimeSources()
  const confirmNavigation = useConfirmSettingsNavigation()
  const settingsTarget = useOptionalSettingsTarget()
  const { activeRuntimeId, refreshRuntime } = useWorkspace()
  const [chosen, setChosen] = useApplicationState(initialRuntimeId ?? '')
  const [refreshing, setRefreshing] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const generation = useRef(0)
  const setSettingsTarget = settingsTarget?.setTarget
  useEffect(() => {
    let active = true
    void (async () => {
      if (
        initialRuntimeId &&
        setSettingsTarget &&
        !(await setSettingsTarget({ environmentId: initialRuntimeId, projectId: '' }))
      )
        return
      if (active) setChosen(initialRuntimeId ?? '')
    })()
    return () => {
      active = false
    }
  }, [initialRuntimeId, setChosen, setSettingsTarget])
  const selectedId = initialRuntimeId ? chosen : settingsTarget?.target.environmentId || chosen
  const source =
    sources.find((entry) => entry.profile.id === selectedId) ??
    sources.find((entry) => entry.profile.id === activeRuntimeId) ??
    sources[0]
  useEffect(() => {
    generation.current++
    setRefreshing(false)
    setError('')
    return () => {
      generation.current++
    }
  }, [source?.scope, setRefreshing, setError])
  const retry = async () => {
    if (!source || refreshing) return
    const current = generation.current
    setRefreshing(true)
    setError('')
    try {
      await refreshRuntime(source.profile)
    } catch (failure) {
      if (current === generation.current)
        setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (current === generation.current) setRefreshing(false)
    }
  }
  return (
    <SettingsPage
      title={title}
      description={description}
      beforeToolbar={localSettings}
      toolbar={
        source && (
          <div className="studio-settings-target space-y-2">
            <h2 className="text-sm font-semibold">Computer settings</h2>
            <div className="studio-settings-target-inner flex max-w-3xl flex-wrap items-center gap-3">
              <SettingsStorageInfo>
                <span title={`Computer: ${source.name}`}>Computer: {source.name}</span>
                {source.connected && saveInfo && (
                  <>
                    {' '}
                    · <span>{saveInfo}</span>
                  </>
                )}
              </SettingsStorageInfo>
              {sources.length > 1 && (
                <ChoicePicker
                  aria-label="Computer"
                  className="h-9 w-48 min-w-0 max-w-full rounded-md px-2 text-xs"
                  value={source.profile.id}
                  disabled={refreshing}
                  onValueChange={async (value) => {
                    const current = ++generation.current
                    const accepted = settingsTarget
                      ? await settingsTarget.setTarget({
                          environmentId: value,
                          projectId:
                            settingsTarget.target.environmentId === value
                              ? settingsTarget.target.projectId
                              : '',
                        })
                      : await confirmNavigation()
                    if (accepted && current === generation.current) setChosen(value)
                  }}
                >
                  {sources.map((entry) => (
                    <option key={entry.profile.id} value={entry.profile.id}>
                      {entry.name}
                      {entry.connected ? '' : ' · Offline'}
                    </option>
                  ))}
                </ChoicePicker>
              )}
              {!source.connected && (
                <span role="status" className="text-[0.8125rem] leading-normal text-foreground/80">
                  Offline · edits kept here
                </span>
              )}
            </div>
          </div>
        )
      }
    >
      {!source ? (
        <p className="text-[0.8125rem] leading-normal text-foreground/80">
          Connect a computer in Devices & runtime to change these settings.
        </p>
      ) : (
        <WorkspaceScope key={source.scope} profile={source.profile}>
          {!source.connected && (
            <div className="space-y-3">
              <p role="status" className="text-[0.8125rem] leading-normal text-foreground/80">
                {source.name} is offline. Your unsaved edits are kept here. Reconnect to save
                changes.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={refreshing}
                onClick={() => void retry()}
              >
                {refreshing ? 'Connecting…' : 'Retry connection'}
              </Button>
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}
          {children}
        </WorkspaceScope>
      )}
    </SettingsPage>
  )
}
