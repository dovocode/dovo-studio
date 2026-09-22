import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { RuntimeProfile } from '@dovo/protocol'
import { clientScopeKey } from '@dovo/client-runtime'
import { ActivityLog } from '../runtime/activity'
import { CommandSettings } from '../runtime/command-settings'
import { PairComputer } from '../runtime/pair-computer'
import { ConnectionHelp } from '../runtime/connection-help'
import { RuntimeScope, useRuntime } from '../runtime/provider'
import { Text } from '../ui/text'
import { Sheet } from '../ui/sheet'
import { Action } from '../ui/action'
import { Field } from '../ui/field'
import { colors, styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
import { SettingsGroup, SettingsRow } from './settings-group'
import { ScreenHeader } from '../ui/screen-header'

export default function DevicesScreen() {
  const { profiles, overviews, activeId } = useRuntime()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<RuntimeProfile | null>(null)
  const [shortcuts, setShortcuts] = useState(false)
  const edited = overviews.find(
    (entry) =>
      entry.profile.id === editing?.id &&
      clientScopeKey(entry.profile.connection) === clientScopeKey(editing.connection),
  )
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Computers"
        buttons={
          profiles.length
            ? [{ label: 'Add computer', icon: 'add', onPress: () => setAdding(true) }]
            : []
        }
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: 8, gap: 20 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {profiles.length ? (
          <SettingsGroup footer="Tasks, projects and tools appear together across these computers.">
            {overviews.map((entry, index) => (
              <SettingsRow
                key={entry.profile.id}
                title={entry.profile.name}
                subtitle={
                  entry.connected
                    ? 'Online'
                    : entry.lastSeen
                      ? 'Offline · Saved workspace available'
                      : 'Not connected'
                }
                icon="device"
                tint={entry.connected ? colors.accent : colors.muted}
                last={index === overviews.length - 1}
                label={`Manage ${entry.profile.name}`}
                testID={
                  entry.connected && entry.profile.id === activeId
                    ? 'Connected computer'
                    : `Computer ${entry.profile.id}`
                }
                onPress={() => setEditing(entry.profile)}
              />
            ))}
          </SettingsGroup>
        ) : (
          <PairComputer />
        )}
        <SettingsGroup title="Tools">
          <SettingsRow
            title="iOS Shortcuts"
            icon="jobs"
            tint="#bb9aff"
            onPress={() => setShortcuts(true)}
            last
          />
        </SettingsGroup>
      </ScrollView>
      {adding && (
        <Sheet title="Connect a computer" onClose={() => setAdding(false)}>
          <PairComputer inSheet onPaired={() => setAdding(false)} />
        </Sheet>
      )}
      {edited && (
        <RuntimeScope key={clientScopeKey(edited.profile.connection)} runtimeId={edited.profile.id}>
          <ComputerSettings onClose={() => setEditing(null)} />
        </RuntimeScope>
      )}
      {shortcuts && (
        <Sheet title="iOS Shortcuts" onClose={() => setShortcuts(false)}>
          <Text style={styles.text}>
            In Shortcuts: Ask for Input → URL Encode → Text with the URL below → Open URLs. Review
            the draft, model and checkout before sending its first message.
          </Text>
          <Text selectable style={styles.muted}>
            dovo://task?text=URL_ENCODED_INPUT
          </Text>
          <Text style={styles.muted}>
            Optional URL fields: title, repositoryId, agentId. Requests wait on this phone while
            offline.
          </Text>
        </Sheet>
      )}
    </View>
  )
}
function ComputerSettings({ onClose }: { onClose: () => void }) {
  const {
    profile,
    snapshot,
    connected,
    error: connectionError,
    refresh,
    renameRuntime,
    forgetRuntime,
  } = useRuntime()
  const { busy, error, act } = useAction()
  const [name, setName] = useState(profile?.name ?? '')
  const [help, setHelp] = useState(false)
  const [panel, setPanel] = useState<'commands' | 'activity' | null>(null)
  if (!profile) return null
  return (
    <Sheet title={profile.name} busy={busy} onClose={onClose}>
      {panel ? (
        <>
          <Action secondary label="Back to computer" onPress={() => setPanel(null)} />
          {panel === 'commands' ? <CommandSettings /> : <ActivityLog />}
        </>
      ) : (
        <>
          <Text style={[styles.text, { color: connected ? colors.accent : colors.muted }]}>
            {connected ? 'Online' : 'Offline'}
          </Text>
          <Text selectable style={styles.muted}>
            {profile.connection.address}
          </Text>
          <Action label="Reconnect" disabled={busy} onPress={() => act(refresh)} />
          {!!(error || connectionError) && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error || connectionError}
            </Text>
          )}
          <SettingsGroup title="On this computer">
            <SettingsRow
              title="CLI commands & shell"
              icon="terminal"
              disabled={!connected}
              onPress={() => setPanel('commands')}
            />
            <SettingsRow
              title="Activity log"
              icon="tasks"
              disabled={!connected}
              onPress={() => setPanel('activity')}
              last
            />
          </SettingsGroup>
          <Field label="Computer name" value={name} onChangeText={setName} maxLength={80} />
          <Action
            secondary
            label="Save name"
            disabled={busy || !name.trim() || name.trim() === profile.name}
            onPress={() =>
              act(async () => {
                await renameRuntime(profile.id, name)
                onClose()
              })
            }
          />
          {!!snapshot?.devices.length && (
            <SettingsGroup title="Paired devices">
              {snapshot.devices.map((device) => (
                <View key={device.id} style={{ padding: 14, gap: 2 }}>
                  <Text style={styles.text}>{device.name}</Text>
                  <Text style={styles.muted}>
                    {device.revokedAt ? 'Revoked' : 'Trusted device'}
                  </Text>
                </View>
              ))}
            </SettingsGroup>
          )}
          <Action
            secondary
            label={help ? 'Hide connection help' : 'Connection help'}
            onPress={() => setHelp(!help)}
          />
          {help && <ConnectionHelp />}
          <Text style={styles.muted}>
            Forgetting removes this connection from your phone. Work on the computer continues.
          </Text>
          <Action
            secondary
            label="Forget computer"
            disabled={busy}
            onPress={() =>
              act(async () => {
                await forgetRuntime(profile.id)
                onClose()
              })
            }
          />
        </>
      )}
    </Sheet>
  )
}
