import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { AccountPanel } from '../runtime/connection/account-panel'
import { ServiceUrlSettings } from '../runtime/connection/service-url-settings'
import { RuntimeIconSettings } from '../runtime/connection/runtime-icon-settings'
import { runtimeIconName } from '../ui/content/runtime-icon'
import {
  workspaceRecoveriesSchema,
  type WorkspaceRecovery,
  runtimeComputerName,
} from '@dovo/protocol'
import { DeviceHostSettings } from './device-host-settings'
import { ComputerUpdates } from './computer-updates'
import { TaskDefaultSettings } from '../runtime/preferences/task-default-settings'
import { RuntimePreferences } from '../runtime/connection/runtime-preferences'
import { useEffect, useRef, useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import {
  pairingInvitation,
  decode,
  peerConfigSchema,
  isPeerAddress,
  type PairingInvitation,
} from '@dovo/protocol'
import { mobileWorkflow } from '../runtime/state/native-effect'
import { useApplicationState } from '../runtime/state/application-state'
import { Alert, Platform, ScrollView, View } from 'react-native'
import type { RuntimeProfile } from '@dovo/protocol'
import { clientScopeKey } from '@dovo/client-runtime'
import { ActivityLog } from '../runtime/state/activity'
import { CommandSettings } from '../runtime/preferences/command-settings'
import { PairComputer } from '../runtime/connection/pair-computer'
import { UpgradeInternet } from '../runtime/connection/upgrade-internet'
import { ConnectSettings } from '../runtime/connection/connect-settings'
import { RelaySettings } from '../runtime/connection/relay-settings'
import { PeerRelayChoice } from '../runtime/connection/peer-relay-choice'
import { ConnectionHelp } from '../runtime/connection/connection-help'
import { useConnectionTypes } from '../runtime/connection/connection-type'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { Text } from '../ui/content/text'
import { SettingsSheet as Sheet } from './settings-theme'
import { SettingsAction as Action } from './settings-controls'
import { SettingsField as Field } from './settings-controls'
import { useSettingsTheme as useTheme, SettingsPage } from './settings-theme'
import { useAction } from '../ui/controls/use-action'
import { SettingsGroup, SettingsRow } from './settings-group'
import { ScreenHeader } from '../ui/layout/screen-header'
export default function DevicesScreen() {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()

  const runtime = useRuntime()
  const connectionType = useConnectionTypes()
  const { profiles, overviews, activeId, error: runtimeError } = runtime
  const [discoveredAddress, setDiscoveredAddress] = useState<string | undefined>(undefined)
  const [adding, setAdding] = useApplicationState(false)
  // Saved before pairing completes: by then the new computer is already in the list.
  const firstPairing = useRef(false)
  const [pairingBusy, setPairingBusy] = useApplicationState(false)
  const [pairTarget, setPairTarget] = useApplicationState<string | null | undefined>(undefined)
  const [editing, setEditing] = useApplicationState<RuntimeProfile | null>(null)
  const params = useLocalSearchParams<{
    address?: string
    code?: string
    peer?: string
    expiresAt?: string
    pairingError?: string
    pair?: string
  }>()
  const [invitation, setInvitation] = useApplicationState<PairingInvitation | undefined>(undefined)
  const [invitationError, setInvitationError] = useApplicationState('')
  useEffect(() => {
    if (adding) firstPairing.current = !profiles.length
  }, [adding])
  useEffect(() => {
    if (params.pair !== '1') return
    setAdding(true)
    router.setParams({ pair: undefined })
  }, [params.pair])
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
          ...(params.peer ? { peer: decode(peerConfigSchema, JSON.parse(params.peer)) } : {}),
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
      peer: undefined,
      pairingError: undefined,
    })
  }, [params.address, params.code, params.expiresAt, params.peer, params.pairingError])
  const [shortcuts, setShortcuts] = useApplicationState(false)
  const edited = overviews.find(
    (entry) =>
      entry.profile.id === editing?.id &&
      clientScopeKey(entry.profile.connection) === clientScopeKey(editing.connection),
  )
  return (
    <SettingsPage>
      <ScreenHeader
        title={uiText('Computers')}
        buttons={
          profiles.length
            ? [
                {
                  label: uiText('Add computer'),
                  icon: 'add',
                  onPress: () => {
                    setInvitation(undefined)
                    setDiscoveredAddress(undefined)
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
        <ServiceUrlSettings />
        <AccountPanel
          onPair={(address) => {
            setDiscoveredAddress(address)
            setInvitation(undefined)
            setPairTarget(null)
            setAdding(true)
          }}
        />
        {!!runtimeError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {runtimeError}
          </Text>
        )}
        {!runtime.registryLoaded && !!runtimeError && (
          <Action
            label={uiText('Retry loading saved computers')}
            onPress={() => runtime.refreshAll()}
          />
        )}
        {!!invitationError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {invitationError}
          </Text>
        )}
        {profiles.length ? (
          <SettingsGroup
            footer={uiText('Tasks, projects and tools appear together across these computers.')}
          >
            {overviews.map((entry, index) => (
              <SettingsRow
                key={entry.profile.id}
                title={runtimeComputerName(entry)}
                subtitle={
                  entry.connected
                    ? uiText('Online · {value0}', {
                        value0: connectionType(entry.profile.connection, entry.connected)?.label,
                      })
                    : !entry.error
                      ? uiText('Connecting…')
                      : entry.lastSeen
                        ? uiText('Offline · Saved workspace available')
                        : uiText('Not connected')
                }
                icon={runtimeIconName(entry.snapshot?.runtimeIcon)}
                tint={entry.connected ? colors.accent : colors.muted}
                last={index === overviews.length - 1}
                label={uiText('Manage {value0}', { value0: runtimeComputerName(entry) })}
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
            label={invitation ? uiText('Continue pairing') : uiText('Connect a computer')}
            onPress={() => {
              setDiscoveredAddress(undefined)
              setAdding(true)
            }}
          />
        )}
        {!!profiles.length && <ComputerUpdates />}
        <SettingsGroup title={uiText('Tools')}>
          <SettingsRow
            title={
              Platform.OS === 'ios' ? uiText('Shortcuts & quick launch') : uiText('Quick launch')
            }
            icon="jobs"
            tint="#bb9aff"
            onPress={() => setShortcuts(true)}
            last
          />
        </SettingsGroup>
      </ScrollView>
      {adding && (
        <Sheet
          title={uiText('Connect a computer')}
          busy={pairingBusy}
          onClose={() => setAdding(false)}
        >
          {invitation && profiles.length > 0 && pairTarget === undefined ? (
            <>
              <Text style={styles.text}>
                <InterfaceText>
                  {'Use this code to connect a new computer or update one you have already saved.'}
                </InterfaceText>
              </Text>
              <Text selectable style={styles.muted}>
                {invitation.peer
                  ? uiText('Internet pairing · end-to-end encrypted')
                  : invitation.address}
              </Text>
              {profiles.map((profile) => (
                <Action
                  key={profile.id}
                  secondary
                  label={uiText('Update {value0}', {
                    value0: runtimeComputerName({
                      profile,
                      snapshot: overviews.find((entry) => entry.profile.id === profile.id)
                        ?.snapshot,
                    }),
                  })}
                  onPress={() => setPairTarget(profile.id)}
                />
              ))}
              <Action label={uiText('Add a new computer')} onPress={() => setPairTarget(null)} />
            </>
          ) : (
            <>
              {pairTarget && (
                <Text style={styles.text}>
                  <InterfaceText
                    values={{ value0: profiles.find((profile) => profile.id === pairTarget)?.name }}
                  >
                    {'Updating {value0}. Pair only with that same computer.'}
                  </InterfaceText>
                </Text>
              )}
              {invitation && (
                <Action
                  secondary
                  label={uiText('Choose a different computer')}
                  disabled={pairingBusy}
                  onPress={() => setPairTarget(undefined)}
                />
              )}
              <PairComputer
                key={`${invitation?.code ?? discoveredAddress ?? 'manual'}:${pairTarget ?? 'new'}`}
                initialAddress={discoveredAddress}
                invitation={invitation}
                replaceId={pairTarget ?? undefined}
                onBusyChange={setPairingBusy}
                inSheet
                onPaired={() => {
                  const first = firstPairing.current
                  setAdding(false)
                  setDiscoveredAddress(undefined)
                  setInvitation(undefined)
                  setPairingBusy(false)
                  // A first computer means the user came to work; take them to their tasks.
                  if (first) router.navigate('/')
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
        <Sheet
          title={
            Platform.OS === 'ios' ? uiText('Shortcuts & quick launch') : uiText('Quick launch')
          }
          onClose={() => setShortcuts(false)}
        >
          <Text style={styles.text}>
            <InterfaceText>
              {
                'Long-press Dovo’s app icon and choose Start a task to select a server, project and favorite agent.'
              }
            </InterfaceText>
          </Text>
          <Action
            label={uiText('Open task launcher')}
            onPress={() => {
              setShortcuts(false)
              router.push('/launch')
            }}
          />
          <Text style={styles.muted}>
            {Platform.OS === 'ios'
              ? uiText(
                  'In Apple Shortcuts, add an Open URLs action with the link below. You can assign it to Siri, your Home Screen or Action button.',
                )
              : uiText(
                  'Supported Android launchers also let you drag the Start a task shortcut onto your Home Screen.',
                )}
          </Text>
          <Text selectable style={styles.muted}>
            <InterfaceText>{'dovo://launch'}</InterfaceText>
          </Text>
          <Text style={styles.text}>
            <InterfaceText>
              {
                'In Shortcuts: Ask for Input → URL Encode → Text with the URL below → Open URLs. Review the draft, model and checkout before sending its first message.'
              }
            </InterfaceText>
          </Text>
          <Text selectable style={styles.muted}>
            <InterfaceText>{'dovo://task?text=URL_ENCODED_INPUT'}</InterfaceText>
          </Text>
          <Text style={styles.muted}>
            <InterfaceText>
              {
                'Optional URL fields: title, repositoryId, agentId. Requests wait on this phone while offline.'
              }
            </InterfaceText>
          </Text>
        </Sheet>
      )}
    </SettingsPage>
  )
}
function ComputerSettings({ onClose }: { onClose: () => void }) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()
  const connectionType = useConnectionTypes()

  const {
    profile,
    snapshot,
    connected,
    recovering,
    error: connectionError,
    refresh,
    renameRuntimeEffect,
    setPeerRelayEffect,
    forgetRuntimeEffect,
  } = useRuntime()
  const { busy, error, act } = useAction()
  const [name, setName] = useApplicationState(profile?.name ?? '')
  const [help, setHelp] = useApplicationState(false)
  const [changingAddress, setChangingAddress] = useApplicationState(false)
  const [pairingBusy, setPairingBusy] = useApplicationState(false)
  const [deviceHostsBusy, setDeviceHostsBusy] = useApplicationState(false)
  const [deviceHostsDirty, setDeviceHostsDirty] = useApplicationState(false)
  const leaveDeviceHosts = (leave: () => void) => {
    if (deviceHostsBusy) return
    if (!deviceHostsDirty) return leave()
    Alert.alert(
      uiText('Discard device host draft?'),
      uiText('Your unsaved host changes will be discarded.'),
      [
        { text: uiText('Keep editing'), style: 'cancel' },
        {
          text: uiText('Discard'),
          style: 'destructive',
          onPress: () => {
            setDeviceHostsDirty(false)
            leave()
          },
        },
      ],
    )
  }
  const [panel, setPanel] = useApplicationState<
    'commands' | 'computer-use' | 'activity' | 'device-hosts' | 'recovered-edits' | null
  >(null)
  if (!profile) return null
  return (
    <Sheet
      title={runtimeComputerName({ profile, snapshot })}
      busy={busy || pairingBusy || deviceHostsBusy}
      onClose={() => leaveDeviceHosts(onClose)}
    >
      {changingAddress ? (
        <>
          <Action
            secondary
            label={uiText('Back to computer')}
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
          <Action
            secondary
            label={uiText('Back to computer')}
            disabled={deviceHostsBusy}
            onPress={() => leaveDeviceHosts(() => setPanel(null))}
          />
          {panel === 'device-hosts' ? (
            <DeviceHostSettings
              key={profile.id}
              onBusyChange={setDeviceHostsBusy}
              onDirtyChange={setDeviceHostsDirty}
            />
          ) : panel === 'recovered-edits' ? (
            <RecoveredEdits />
          ) : panel === 'activity' ? (
            <ActivityLog />
          ) : (
            <CommandSettings computerUse={panel === 'computer-use'} />
          )}
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
            {connected
              ? uiText('Online')
              : recovering
                ? uiText('Reconnecting…')
                : uiText('Offline')}
          </Text>
          {connected && (
            <Text style={styles.muted}>{connectionType(profile.connection, connected)?.label}</Text>
          )}
          <Text selectable style={styles.muted}>
            {isPeerAddress(profile.connection.address)
              ? uiText('Internet · WebRTC · end-to-end encrypted')
              : profile.connection.address}
          </Text>
          <ConnectSettings key={profile.id} onBusyChange={setPairingBusy} />
          <RelaySettings key={`relay-${profile.id}`} onBusyChange={setPairingBusy} />
          {profile.connection.peer && (
            <PeerRelayChoice
              value={profile.connection.peer.relay}
              disabled={busy}
              onChange={(relay) => act(() => setPeerRelayEffect(profile.id, relay))}
            />
          )}
          {profile.connection.internet && (
            <Text style={styles.muted}>
              <InterfaceText>
                {
                  'LAN / VPN is preferred. Dovo Connect is available as an encrypted internet fallback.'
                }
              </InterfaceText>
            </Text>
          )}
          {!profile.connection.peer &&
            !profile.connection.internet &&
            snapshot?.peerUpgradeSupported && (
              <UpgradeInternet key={profile.id} profile={profile} onBusyChange={setPairingBusy} />
            )}
          {!profile.connection.peer && connected && snapshot && !snapshot.peerUpgradeSupported && (
            <Text style={styles.muted}>
              <InterfaceText>
                {'Update Dovo on this computer to enable internet access without re-pairing.'}
              </InterfaceText>
            </Text>
          )}
          <Action
            label={uiText('Reconnect')}
            disabled={busy || pairingBusy}
            onPress={() => act(refresh)}
          />
          <Action
            secondary
            label={
              profile.connection.accountSession
                ? uiText('Pair LAN / VPN')
                : profile.connection.internet
                  ? uiText('Update LAN / VPN pairing')
                  : uiText('Update connection address')
            }
            disabled={busy || pairingBusy}
            onPress={() => setChangingAddress(true)}
          />
          {!!(error || connectionError) && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error || connectionError}
            </Text>
          )}
          <RuntimeIconSettings />
          <RuntimePreferences />
          <TaskDefaultSettings />
          <SettingsGroup title={uiText('On this computer')}>
            <SettingsRow
              title={uiText('Device previews')}
              subtitle={uiText('Remote SSH device hosts')}
              icon="device"
              onPress={() => setPanel('device-hosts')}
            />
            <SettingsRow
              title={uiText('CLI commands & shell')}
              icon="terminal"
              disabled={!connected}
              onPress={() => setPanel('commands')}
            />
            <SettingsRow
              title={uiText('Computer use')}
              icon="terminal"
              disabled={!connected}
              onPress={() => setPanel('computer-use')}
            />
            {connected && (
              <SettingsRow
                title={uiText('Recovered edits')}
                icon="tasks"
                disabled={!connected}
                onPress={() => setPanel('recovered-edits')}
              />
            )}
            <SettingsRow
              title={uiText('Activity log')}
              icon="tasks"
              disabled={!connected}
              onPress={() => setPanel('activity')}
              last
            />
          </SettingsGroup>
          <Field
            label={uiText('Computer name')}
            value={name}
            onChangeText={setName}
            maxLength={80}
          />
          <Action
            secondary
            label={uiText('Save name')}
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
            <SettingsGroup title={uiText('Paired devices')}>
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
                    {device.revokedAt ? uiText('Revoked') : uiText('Trusted device')}
                  </Text>
                </View>
              ))}
            </SettingsGroup>
          )}
          <Action
            secondary
            label={help ? uiText('Hide connection help') : uiText('Connection help')}
            onPress={() => setHelp(!help)}
          />
          {help && <ConnectionHelp />}
          <Text style={styles.muted}>
            <InterfaceText>
              {
                'Forgetting removes this connection from your phone. Work on the computer continues.'
              }
            </InterfaceText>
          </Text>
          <Action
            destructive
            secondary
            label={uiText('Forget computer')}
            disabled={busy}
            onPress={() =>
              // Undoing this needs a fresh pairing code from the computer, so confirm first.
              Alert.alert(
                uiText('Forget {value0}?', { value0: runtimeComputerName({ profile, snapshot }) }),
                uiText(
                  'This phone’s access is removed from the computer too. Connecting again needs a new pairing code. Work on the computer continues.',
                ),
                [
                  { text: uiText('Cancel'), style: 'cancel' },
                  {
                    text: uiText('Forget'),
                    style: 'destructive',
                    onPress: () =>
                      act(() =>
                        mobileWorkflow(function* () {
                          yield* forgetRuntimeEffect(profile.id)
                          onClose()
                        }),
                      ),
                  },
                ],
              )
            }
          />
        </>
      )}
    </Sheet>
  )
}

function RecoveredEdits() {
  const uiText = useInterfaceText()

  const { read } = useRuntime()
  const { styles } = useTheme()
  const [edits, setEdits] = useApplicationState<WorkspaceRecovery[]>([])
  const [cursor, setCursor] = useApplicationState<string | undefined>(undefined)
  const [loading, setLoading] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [warnings, setWarnings] = useApplicationState<string[]>([])
  useEffect(() => {
    let stopped = false
    void read('/api/workspace/recovered-edits', undefined, workspaceRecoveriesSchema, 'GET')
      .then((value) => {
        if (!stopped) {
          setEdits(value.edits)
          setWarnings(value.warnings ?? [])
          setCursor(value.nextCursor)
        }
      })
      .catch((error) => {
        if (!stopped) setError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      stopped = true
    }
  }, [read])
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.text}>
        <InterfaceText>
          {
            'Conflicting edits are saved here while the runtime value stays in use. Select and copy an edit to recover it.'
          }
        </InterfaceText>
      </Text>
      {warnings.map((warning) => (
        <Text key={warning} style={styles.text}>
          {warning}
        </Text>
      ))}
      {!!error && <Text style={styles.text}>{error}</Text>}
      {edits.length === 0
        ? !error && (
            <Text style={styles.text}>
              <InterfaceText>{'No recovered edits.'}</InterfaceText>
            </Text>
          )
        : edits.map((edit) => (
            <Text selectable key={edit.id} style={styles.text}>
              {JSON.stringify(edit, null, 2)}
            </Text>
          ))}
      {cursor && (
        <Action
          label={uiText('Load older edits')}
          disabled={loading}
          onPress={() => {
            setLoading(true)
            void read(
              '/api/workspace/recovered-edits?cursor=' + encodeURIComponent(cursor),
              undefined,
              workspaceRecoveriesSchema,
              'GET',
            )
              .then((value) => {
                setEdits((previous) => [
                  ...new Map([...previous, ...value.edits].map((edit) => [edit.id, edit])).values(),
                ])
                setCursor(value.nextCursor)
              })
              .catch((error) => setError(error instanceof Error ? error.message : String(error)))
              .finally(() => setLoading(false))
          }}
        />
      )}
    </View>
  )
}
