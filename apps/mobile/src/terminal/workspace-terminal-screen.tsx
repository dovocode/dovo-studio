import { useEffect, useState } from 'react'
import { Alert, View } from 'react-native'
import { router } from 'expo-router'
import {
  responses,
  runtimeComputerName,
  runtimeReachability,
  STUDIO_TERMINAL_SCOPE,
  terminalStatus,
} from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { useNavigation } from '../shell/navigation'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Action } from '../ui/controls/action'
import { EmptyState } from '../ui/content/empty-state'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { ResourceActions, useTerminalActions } from '../workspace/resource-actions'
import { workspaceItems } from '../workspace/workspace-items'
import { TerminalSession } from './terminal-session'
import { TerminalRename } from './terminal-rename'

export function WorkspaceTerminalScreen({
  runtimeId,
  terminalId,
}: {
  runtimeId: string
  terminalId: string
}) {
  const runtime = useRuntime()
  const { focused } = useNavigation()
  const { styles } = useTheme()
  const owner = runtime.overviews.find((entry) => entry.profile.id === runtimeId)
  const loading =
    !runtime.ready ||
    (!!owner &&
      (runtimeReachability(owner) === 'connecting' || (owner.connected && !owner.snapshot)))
  const terminal = owner?.snapshot?.terminals.find(
    (entry) => entry.id === terminalId && entry.taskId === STUDIO_TERMINAL_SCOPE,
  )
  const actions = useTerminalActions(runtimeId, terminal)
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  useEffect(() => {
    setRenaming(false)
  }, [
    runtimeId,
    terminalId,
    focused,
    owner?.profile.connection.address,
    owner?.profile.connection.token,
  ])
  const [generation, setGeneration] = useState(0)
  const [closing, setClosing] = useState(false)
  const status = terminal && terminalStatus(terminal, !!owner?.connected)
  const item = workspaceItems(owner ? [owner] : [], [], Date.now()).find(
    (entry) => entry.kind === 'terminal' && entry.terminal.id === terminalId,
  )
  const back = () => (router.canGoBack() ? router.back() : router.replace('/terminal'))
  const close = () =>
    Alert.alert(
      'Close terminal?',
      'This ends its running processes and removes its saved session. Settle it to keep it for later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close terminal',
          style: 'destructive',
          onPress: () => {
            if (!owner?.connected || closing) return
            setClosing(true)
            void runtime
              .readRuntime(owner.profile, '/api/terminals/close', { id: terminalId }, responses.ok)
              .then(() => {
                back()
                return runtime.refreshRuntime(owner.profile)
              })
              .catch((cause: unknown) => Alert.alert('Could not close terminal', String(cause)))
              .finally(() => setClosing(false))
          },
        },
      ],
    )
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={terminal?.title ?? 'Terminal'}
        subtitle={
          owner
            ? `${runtimeComputerName(owner)}${status ? ` · ${status.label}` : ''}`
            : runtime.ready
              ? 'Unpaired computer'
              : 'Loading computer…'
        }
        onBack={back}
        buttons={
          terminal
            ? [
                { label: 'Terminal actions', icon: 'filters', onPress: () => setMenu(true) },
                {
                  label: 'Rename',
                  icon: 'edit',
                  overflow: true,
                  disabled: actions.disabled,
                  onPress: () => {
                    setRenaming(true)
                  },
                },
                {
                  label: 'Automatic title',
                  icon: 'magic',
                  overflow: true,
                  disabled: actions.disabled || !terminal.customTitle,
                  onPress: () => void actions.update({ title: null }),
                },
                {
                  label: 'Reconnect terminal',
                  icon: 'refresh',
                  overflow: true,
                  disabled: !owner?.connected,
                  onPress: () => setGeneration((value) => value + 1),
                },
                {
                  label: 'New terminal',
                  icon: 'add',
                  overflow: true,
                  onPress: () => router.push('/terminal/new'),
                },
                {
                  label: 'Close terminal',
                  icon: 'close',
                  overflow: true,
                  destructive: true,
                  disabled: actions.disabled || closing,
                  onPress: close,
                },
              ]
            : []
        }
      />
      {!terminal ? (
        <EmptyState
          icon="terminal"
          title={loading ? 'Loading terminal…' : 'Terminal unavailable'}
          description={
            loading
              ? 'Waiting for this computer’s terminal sessions.'
              : !owner
                ? 'This computer is no longer paired.'
                : owner.unauthorized
                  ? 'This computer rejected its saved pairing. Pair it again in Computers.'
                  : !owner.connected
                    ? 'Reconnect to this computer to resume its terminals.'
                    : 'This standalone terminal may have been closed.'
          }
          action={<Action secondary label="Back to workspace" onPress={back} />}
        />
      ) : (
        <>
          {(terminal.dormant && !terminal.exited) ||
          terminal.settledAt ||
          (terminal.snoozedUntil && Date.parse(terminal.snoozedUntil) > Date.now()) ? (
            <EmptyState
              icon="terminal"
              title={terminal.dormant ? 'Session sleeping' : 'Session put aside'}
              description={
                terminal.dormant
                  ? 'Restore to resume this session on its computer.'
                  : 'Active commands keep running. Restore to reconnect.'
              }
              action={
                <Action
                  label="Restore terminal"
                  disabled={actions.disabled}
                  onPress={() => void actions.update({ settled: false, snoozedUntil: null })}
                />
              }
            />
          ) : (
            <RuntimeScope
              key={JSON.stringify([
                runtimeId,
                terminalId,
                owner?.profile.connection.address,
                owner?.profile.connection.token,
                owner?.profile.connection.runtimeId,
              ])}
              runtimeId={runtimeId}
            >
              <RetainedTerminalSession id={terminalId} focused={focused} generation={generation} />
            </RuntimeScope>
          )}
        </>
      )}
      {menu && item && <ResourceActions item={item} onClose={() => setMenu(false)} />}
      {renaming && terminal && owner && focused && (
        <TerminalRename session={terminal} owner={owner} onClose={() => setRenaming(false)} />
      )}
    </View>
  )
}

/** Keep a loaded grid mounted during temporary outages and hidden native-stack screens. */
function RetainedTerminalSession({
  id,
  focused,
  generation,
}: {
  id: string
  focused: boolean
  generation: number
}) {
  const { connected } = useRuntime()
  const { styles } = useTheme()
  const [started, setStarted] = useState(false)
  useEffect(() => {
    if (connected && focused) setStarted(true)
  }, [connected, focused])
  if (!started && !(connected && focused))
    return (
      <EmptyState
        icon="device"
        title="Computer offline"
        description="Reconnect to load this session."
      />
    )
  return (
    <>
      {!connected && (
        <Text style={[styles.muted, { padding: 10 }]}>
          Computer offline. Showing retained terminal output.
        </Text>
      )}
      <TerminalSession key={`${id}:${generation}`} id={id} visible={focused} />
    </>
  )
}
