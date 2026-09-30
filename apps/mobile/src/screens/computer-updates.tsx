import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AppState, View } from 'react-native'
import {
  createRuntimeUpgradeManager,
  runtimeUpgradeTargets,
  runtimeUpdate,
  runtimeUpgradeBlocked,
  type RuntimeUpgradeEntry,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { Text } from '../ui/content/text'
import { Action } from '../ui/controls/action'
import { Switch } from '../ui/controls/switch'
import { styles } from '../ui/theme'
import { SettingsGroup } from './settings-group'

export function ComputerUpdates() {
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
  useEffect(() => {
    void manager.check()
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
  }, [manager])
  const eligible = (entry: RuntimeUpgradeEntry) =>
    !runtimeUpgradeBlocked(entry) &&
    runtimeUpdate(entry.snapshot, state.releases).available &&
    !['queued', 'downloading', 'installing', 'downloaded'].includes(
      state.statuses[entry.profile.id]?.status ?? '',
    )
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
    <SettingsGroup
      title="Computer updates"
      footer="Servers install and restart after downloading. Desktop downloads wait for your restart choice and include their bundled server."
    >
      <View style={{ padding: 14, gap: 14 }}>
        <Action
          secondary
          label={state.checking ? 'Checking…' : 'Check updates'}
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
                    {entry.profile.name} · {desktop ? 'Desktop' : 'Server'}
                  </Text>
                  <Text style={styles.muted}>
                    {release.installed ?? 'Version unknown'}
                    {release.available
                      ? ` → ${release.latest?.version}`
                      : release.installed && state.releases
                        ? ' · Up to date'
                        : ''}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel={`Select ${entry.profile.name} for update`}
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
                    ? `Downloading ${Math.round(status.progress ?? 0)}%${status.total ? ` · ${((status.transferred ?? 0) / 1048576).toFixed(1)} / ${(status.total / 1048576).toFixed(1)} MB` : ''}`
                    : status.status === 'installing'
                      ? 'Installing and reconnecting…'
                      : 'Preparing update…'}
                </Text>
              )}
              {status?.status === 'complete' && <Text style={styles.muted}>Update complete</Text>}
              {status?.error && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {status.error}
                </Text>
              )}
              {eligible(entry) && (
                <Action
                  secondary
                  label={desktop ? 'Download update' : 'Update server'}
                  disabled={!!state.busy.length}
                  onPress={() => void manager.start([id])}
                />
              )}
              {downloaded && (
                <>
                  <Text style={styles.muted}>
                    Version {status?.version} downloaded. Restart when you’re ready.
                  </Text>
                  <Action
                    label="Restart and install"
                    disabled={!!state.busy.length || !!blocked}
                    onPress={() => void manager.restart([id])}
                  />
                </>
              )}
            </View>
          )
        })}
        <Action
          label={`Update selected (${selected.length})`}
          disabled={!selected.length || !!state.busy.length}
          onPress={() => void manager.start(selected)}
        />
        {!!ready.length && (
          <Action
            secondary
            label={`Restart selected desktops (${ready.length})`}
            disabled={!!state.busy.length}
            onPress={() => void manager.restart(ready)}
          />
        )}
      </View>
    </SettingsGroup>
  )
}
function ReleaseNotes({ notes }: { notes: string }) {
  const [open, setOpen] = useState(false)
  return (
    <View style={{ gap: 8 }}>
      <Action
        secondary
        label={open ? 'Hide release notes' : 'What’s new'}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <Text selectable style={styles.muted}>
          {notes || 'Release notes are unavailable.'}
        </Text>
      )}
    </View>
  )
}
