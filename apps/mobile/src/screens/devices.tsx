import { RuntimePreferences } from '../runtime/runtime-preferences'
import { useEffect } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { pairingInvitation, type PairingInvitation } from '@dovo/protocol'
import { mobileWorkflow } from '../runtime/native-effect'
import { useApplicationState } from '../runtime/application-state'
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
  const { profiles, overviews, activeId, error: runtimeError } = useRuntime()
  const [adding, setAdding] = useApplicationState(false)
  const [pairingBusy, setPairingBusy] = useApplicationState(false)
  const [pairTarget, setPairTarget] = useApplicationState<string | null | undefined>(undefined)
  const [editing, setEditing] = useApplicationState<RuntimeProfile | null>(null)
  const params = useLocalSearchParams<{
    address?: string
    code?: string
    expiresAt?: string
    pairingError?: string
  }>()
  const [invitation, setInvitation] = useApplicationState<PairingInvitation | undefined>(undefined)
  const [invitationError, setInvitationError] = useApplicationState('')
  useEffect(() => {
    if (!params.code && !params.pairingError) return
    try {
      if (params.pairingError) throw new Error(params.pairingError)
      if (pairingBusy)
        throw new Error('Finish or cancel the current pairing before opening another code.')
      setInvitation(
        pairingInvitation({
          address: params.address ?? '',
          code: params.code ?? '',
          expiresAt: params.expiresAt ?? '',
        }),
      )
      setInvitationError('')
      setPairTarget(profiles.length ? undefined : null)
      setEditing(null)
      setAdding(true)
    } catch (error) {
      setInvitationError(error instanceof Error ? error.message : 'Could not read pairing link.')
    }
    router.setParams({
      address: undefined,
      code: undefined,
      expiresAt: undefined,
      pairingError: undefined,
    })
  }, [params.address, params.code, params.expiresAt, params.pairingError])
  const [shortcuts, setShortcuts] = useApplicationState(false)
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
            ? [
                {
                  label: 'Add computer',
                  icon: 'add',
                  onPress: () => {
                    setInvitation(undefined)
                    setPairTarget(null)
                    setAdding(true)
                  },
                },
              ]
            : []
        }
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: 8,
            gap: 20,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {!!runtimeError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {runtimeError}
          </Text>
        )}
        {!!invitationError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {invitationError}
          </Text>
        )}
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
          <Action
            label={invitation ? 'Continue pairing' : 'Connect a computer'}
            onPress={() => setAdding(true)}
          />
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
        <Sheet title="Connect a computer" busy={pairingBusy} onClose={() => setAdding(false)}>
          {invitation && profiles.length > 0 && pairTarget === undefined ? (
            <>
              <Text style={styles.text}>
                Use this code to connect a new computer or update one you have already saved.
              </Text>
              <Text selectable style={styles.muted}>
                {invitation.address}
              </Text>
              {profiles.map((profile) => (
                <Action
                  key={profile.id}
                  secondary
                  label={`Update ${profile.name}`}
                  onPress={() => setPairTarget(profile.id)}
                />
              ))}
              <Action label="Add a new computer" onPress={() => setPairTarget(null)} />
            </>
          ) : (
            <>
              {pairTarget && (
                <Text style={styles.text}>
                  Updating {profiles.find((profile) => profile.id === pairTarget)?.name}. Pair only
                  with that same computer.
                </Text>
              )}
              {invitation && (
                <Action
                  secondary
                  label="Choose a different computer"
                  disabled={pairingBusy}
                  onPress={() => setPairTarget(undefined)}
                />
              )}
              <PairComputer
                key={`${invitation?.code ?? 'manual'}:${pairTarget ?? 'new'}`}
                invitation={invitation}
                replaceId={pairTarget ?? undefined}
                onBusyChange={setPairingBusy}
                inSheet
                onPaired={() => {
                  setAdding(false)
                  setInvitation(undefined)
                  setPairingBusy(false)
                }}
              />
            </>
          )}
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
    renameRuntimeEffect,
    forgetRuntimeEffect,
  } = useRuntime()
  const { busy, error, act } = useAction()
  const [name, setName] = useApplicationState(profile?.name ?? '')
  const [help, setHelp] = useApplicationState(false)
  const [changingAddress, setChangingAddress] = useApplicationState(false)
  const [pairingBusy, setPairingBusy] = useApplicationState(false)
  const [panel, setPanel] = useApplicationState<'commands' | 'activity' | null>(null)
  if (!profile) return null
  return (
    <Sheet title={profile.name} busy={busy || pairingBusy} onClose={onClose}>
      {changingAddress ? (
        <>
          <Action
            secondary
            label="Back to computer"
            disabled={pairingBusy}
            onPress={() => setChangingAddress(false)}
          />
          <PairComputer
            inSheet
            replaceId={profile.id}
            onPaired={onClose}
            onBusyChange={setPairingBusy}
          />
        </>
      ) : panel ? (
        <>
          <Action secondary label="Back to computer" onPress={() => setPanel(null)} />
          {panel === 'commands' ? <CommandSettings /> : <ActivityLog />}
        </>
      ) : (
        <>
          <Text
            style={[
              styles.text,
              {
                color: connected ? colors.accent : colors.muted,
              },
            ]}
          >
            {connected ? 'Online' : 'Offline'}
          </Text>
          <Text selectable style={styles.muted}>
            {profile.connection.address}
          </Text>
          <Action label="Reconnect" disabled={busy} onPress={() => act(refresh)} />
          <Action
            secondary
            label="Update connection address"
            disabled={busy}
            onPress={() => setChangingAddress(true)}
          />
          {!!(error || connectionError) && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error || connectionError}
            </Text>
          )}
          <RuntimePreferences />
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
              act(() =>
                mobileWorkflow(function* () {
                  yield* renameRuntimeEffect(profile.id, name)
                  onClose()
                }),
              )
            }
          />
          {!!snapshot?.devices.length && (
            <SettingsGroup title="Paired devices">
              {snapshot.devices.map((device) => (
                <View
                  key={device.id}
                  style={{
                    padding: 14,
                    gap: 2,
                  }}
                >
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
              act(() =>
                mobileWorkflow(function* () {
                  yield* forgetRuntimeEffect(profile.id)
                  onClose()
                }),
              )
            }
          />
        </>
      )}
    </Sheet>
  )
}
