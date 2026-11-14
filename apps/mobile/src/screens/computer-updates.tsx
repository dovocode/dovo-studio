import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { runtimeComputerName } from '@dovo/protocol'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AppState, View } from 'react-native'
import {
  createRuntimeUpgradeManager,
  runtimeUpgradeTargets,
  runtimeUpgradeIdentity,
  runtimeUpdate,
  runtimeUpgradeBlocked,
  type RuntimeUpgradeEntry,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { Text } from '../ui/content/text'
import { SettingsAction as Action } from './settings-controls'
import { Switch } from '../ui/controls/switch'
import { useTheme } from '../ui/theme'
import { SettingsGroup, SettingsRow } from './settings-group'
import { Sheet } from '../ui/layout/sheet'

export function ComputerUpdates() {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { overviews, refreshRuntime } = useRuntime()
  const targets = runtimeUpgradeTargets(overviews)
  const current = useRef({ overviews: targets, refreshRuntime })
  current.current = { overviews: targets, refreshRuntime }
  const [manager] = useState(() =>
    createRuntimeUpgradeManager({
      entries: () => current.current.overviews,
      refreshed: (entry) => current.current.refreshRuntime(entry.sourceProfile ?? entry.profile),
    }),
  )
  const state = useSyncExternalStore(manager.subscribe, manager.getSnapshot)
  const bindings = JSON.stringify(
    targets.map((entry) => [entry.profile.id, runtimeUpgradeIdentity(entry)]),
  )
  useLayoutEffect(() => manager.sync(), [manager, bindings])
  const [open, setOpen] = useState(false)
  const updating =
    state.busy.length > 0 ||
    Object.values(state.statuses).some((status) =>
      ['queued', 'downloading', 'installing', 'downloaded'].includes(status.status),
    )
  useEffect(() => {
    if (open) void manager.check()
  }, [manager, open])
  useEffect(() => {
    // A closed sheet still tracks updates the user started, including automatic restarts.
    if (!open && !updating) return
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void manager.poll()
    }, 3000)
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void manager.poll()
    })
    return () => {
      clearInterval(timer)
      subscription.remove()
    }
  }, [manager, open, updating])
  const [confirmAll, setConfirmAll] = useState(false)
  const [resumeInterrupted, setResumeInterrupted] = useState(false)
  const eligible = (entry: RuntimeUpgradeEntry) =>
    !runtimeUpgradeBlocked(entry) &&
    runtimeUpdate(entry.snapshot, state.releases).available &&
    !['queued', 'downloading', 'installing', 'downloaded'].includes(
      state.statuses[entry.profile.id]?.status ?? '',
    )
  const all = targets
    .filter(
      (entry) =>
        !runtimeUpgradeBlocked(entry, true) &&
        runtimeUpdate(entry.snapshot, state.releases).available &&
        !['queued', 'downloading', 'installing', 'downloaded'].includes(
          state.statuses[entry.profile.id]?.status ?? '',
        ),
    )
    .map((entry) => entry.profile.id)
  const selected = targets
    .filter((entry) => state.selected.includes(entry.profile.id) && eligible(entry))
    .map((entry) => entry.profile.id)
  const ready = targets
    .filter(
      (entry) =>
        state.selected.includes(entry.profile.id) &&
        !runtimeUpgradeBlocked(entry) &&
        state.statuses[entry.profile.id]?.status === 'downloaded',
    )
    .map((entry) => entry.profile.id)
  return (
    <>
      <SettingsGroup>
        <SettingsRow
          title={uiText('Computer updates')}
          subtitle={
            updating
              ? uiText('Updates in progress or ready to install')
              : uiText('Versions and release notes')
          }
          icon="refresh"
          onPress={() => setOpen(true)}
          last
        />
      </SettingsGroup>
      {open && (
        <Sheet title={uiText('Computer updates')} onClose={() => setOpen(false)}>
          <Text style={styles.muted}>
            <InterfaceText>
              {
                'Servers install and restart after downloading. Desktop downloads wait for your restart choice and include their bundled server.'
              }
            </InterfaceText>
          </Text>
          <View style={{ gap: 14 }}>
            <Action
              secondary
              label={state.checking ? uiText('Checking…') : uiText('Check updates')}
              disabled={state.checking}
              onPress={() => void manager.check()}
            />
            {!!state.error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {state.error}
              </Text>
            )}
            {targets.map((entry) => {
              const id = entry.profile.id,
                release = runtimeUpdate(entry.snapshot, state.releases)
              const desktop = entry.snapshot?.releaseDistribution === 'desktop',
                status = state.statuses[id]
              const downloaded = desktop && status?.status === 'downloaded',
                blocked = runtimeUpgradeBlocked(entry)
              return (
                <View key={id} style={{ gap: 8 }}>
                  <View style={[styles.row, { justifyContent: 'space-between' }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.text}>
                        {runtimeComputerName(entry)} ·{' '}
                        {desktop ? uiText('Desktop') : uiText('Server')}
                      </Text>
                      <Text style={styles.muted}>
                        {release.installed ?? uiText('Version unknown')}
                        {release.available
                          ? ` → ${release.latest?.version}`
                          : release.installed && state.releases
                            ? uiText(' · Up to date')
                            : ''}
                      </Text>
                    </View>
                    <Switch
                      accessibilityLabel={uiText('Select {value0} for update', {
                        value0: runtimeComputerName(entry),
                      })}
                      value={state.selected.includes(id)}
                      disabled={
                        !!state.busy.length ||
                        (!eligible(entry) && !downloaded && !state.selected.includes(id))
                      }
                      onValueChange={() => manager.toggle(id)}
                    />
                  </View>
                  {release.available && <ReleaseNotes notes={release.latest?.notes ?? ''} />}
                  {blocked && <Text style={styles.muted}>{blocked}</Text>}
                  {status && ['queued', 'downloading', 'installing'].includes(status.status) && (
                    <Text accessibilityRole="text" style={styles.muted}>
                      {status.status === 'downloading'
                        ? uiText('Downloading {value0}%{value1}', {
                            value0: Math.round(status.progress ?? 0),
                            value1: status.total
                              ? ` · ${((status.transferred ?? 0) / 1048576).toFixed(1)} / ${(status.total / 1048576).toFixed(1)} MB`
                              : '',
                          })
                        : status.status === 'installing'
                          ? uiText('Installing and reconnecting…')
                          : uiText('Preparing update…')}
                    </Text>
                  )}
                  {status?.status === 'complete' && (
                    <Text style={styles.muted}>
                      <InterfaceText>{'Update complete'}</InterfaceText>
                    </Text>
                  )}
                  {status?.error && (
                    <Text accessibilityRole="alert" style={styles.error}>
                      {status.error}
                    </Text>
                  )}
                  {eligible(entry) && (
                    <Action
                      secondary
                      label={desktop ? uiText('Download update') : uiText('Update server')}
                      disabled={!!state.busy.length}
                      onPress={() => void manager.start([id])}
                    />
                  )}
                  {downloaded && (
                    <>
                      <Text style={styles.muted}>
                        <InterfaceText values={{ value0: status?.version }}>
                          {'Version {value0} downloaded. Restart when you’re ready.'}
                        </InterfaceText>
                      </Text>
                      <Action
                        label={uiText('Restart and install')}
                        disabled={!!state.busy.length || !!blocked}
                        onPress={() => void manager.restart([id])}
                      />
                    </>
                  )}
                </View>
              )
            })}
            <Action
              label={uiText('Update all ({value0})', { value0: all.length })}
              disabled={!all.length || state.checking || !!state.busy.length}
              onPress={() => {
                setResumeInterrupted(false)
                setConfirmAll(true)
              }}
            />
            {confirmAll && (
              <Sheet title={uiText('Update all computers')} onClose={() => setConfirmAll(false)}>
                <View style={{ gap: 16 }}>
                  <Text style={styles.muted}>
                    <InterfaceText>
                      {
                        'Servers install and restart automatically. Desktops download, install and restart. Running desktop threads are interrupted. Leave the box off to resume manually, or enable it to resume automatically after this restart.'
                      }
                    </InterfaceText>
                  </Text>
                  <View style={styles.row}>
                    <Text style={[styles.text, { flex: 1 }]}>
                      <InterfaceText>{'Resume interrupted threads after restart'}</InterfaceText>
                    </Text>
                    <Switch
                      accessibilityLabel={uiText('Resume interrupted threads after restart')}
                      value={resumeInterrupted}
                      onValueChange={setResumeInterrupted}
                    />
                  </View>
                  <Action
                    label={uiText('Update and restart ({value0})', { value0: all.length })}
                    disabled={!all.length || !!state.busy.length}
                    onPress={() => {
                      setConfirmAll(false)
                      void manager.start(all, { restartDesktops: true, resumeInterrupted })
                    }}
                  />
                  <Action secondary label={uiText('Cancel')} onPress={() => setConfirmAll(false)} />
                </View>
              </Sheet>
            )}
            <Action
              label={uiText('Update selected ({value0})', { value0: selected.length })}
              disabled={!selected.length || !!state.busy.length}
              onPress={() => void manager.start(selected)}
            />
            {!!ready.length && (
              <Action
                secondary
                label={uiText('Restart selected desktops ({value0})', { value0: ready.length })}
                disabled={!!state.busy.length}
                onPress={() => void manager.restart(ready)}
              />
            )}
          </View>
        </Sheet>
      )}
    </>
  )
}
function ReleaseNotes({ notes }: { notes: string }) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const [open, setOpen] = useState(false)
  return (
    <View style={{ gap: 8 }}>
      <Action
        secondary
        label={open ? uiText('Hide release notes') : uiText('What’s new')}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <Text selectable style={styles.muted}>
          {notes || uiText('Release notes are unavailable.')}
        </Text>
      )}
    </View>
  )
}
