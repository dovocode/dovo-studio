import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useState } from 'react'
import { Alert, Linking, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import * as Clipboard from 'expo-clipboard'
import { responses, runtimeComputerName, ACCOUNT_DIRECTORY_URL } from '@dovo/protocol'
import { useRuntime } from './provider'
import { useMobileAccount } from './account-provider'
import { preparePeerConnection } from './peer-transport'
import { useAction } from '../../ui/controls/use-action'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function ConnectSettings({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const uiText = useInterfaceText()

  const { profile, snapshot, connected, call, refresh, connect } = useRuntime()
  const {
    client,
    directory,
    login,
    loaded,
    busy: accountBusy,
    error: accountError,
    deletionPending,
  } = useMobileAccount()
  const { busy, error, act } = useAction()
  const [copiedUrl, setCopiedUrl] = useState<string>()
  const { styles } = useTheme()
  useEffect(() => {
    onBusyChange?.(busy)
    return () => onBusyChange?.(false)
  }, [busy, onBusyChange])
  if (!profile) return null
  const name = runtimeComputerName({ profile, snapshot })
  const internet = snapshot?.internet
  const mcp = internet?.remoteMcp
  const lanOnly = snapshot?.relaySettings?.connectionMode === 'lan'
  const setRemoteMcp = async (enabled: boolean) => {
    await call(
      '/api/runtime/internet/remote-mcp',
      { enabled, consent: true },
      responses.internetStatus,
    )
    setCopiedUrl(undefined)
    await refresh()
  }
  const accountServer = directory?.servers.find(
    (server) => server.id === snapshot?.runtimeId && server.internet,
  )
  const connectAccount = async () => {
    const server = client
      .snapshot()
      .directory?.servers.find((server) => server.id === snapshot?.runtimeId && server.internet)
    if (!server) throw new Error('Refresh your account and try connecting again')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 25000)
    try {
      const connection = await client.connectInternet(
        server,
        Crypto.getRandomBytes(32),
        controller.signal,
      )
      if (!connection.peer) throw new Error('Computer did not provide an encrypted connection')
      preparePeerConnection(connection.peer)
      await connect(connection, name)
    } finally {
      clearTimeout(timer)
    }
  }
  const enable = async () => {
    if (!snapshot?.runtimeId) throw new Error('Reconnect to this computer first')
    if (client.origin !== ACCOUNT_DIRECTORY_URL && !snapshot.internet?.origin)
      throw new Error('Update this computer before using a custom Connect URL')
    await client.enablePairedInternet(
      snapshot.runtimeId,
      (session) =>
        call(
          '/api/runtime/internet/setup',
          { session, consent: true, relay: 'dovo', origin: client.origin },
          responses.internetSetup,
        ),
      (id, grant) =>
        call('/api/runtime/internet/complete', { id, grant }, responses.internetStatus),
    )
    await refresh()
    // Save a distinct account credential alongside the existing LAN/VPN pairing.
    await connectAccount()
  }
  return (
    <View
      style={{ gap: 8 }}
      accessibilityLabel={uiText('Dovo Connect for {value0}', { value0: name })}
    >
      <Text style={styles.title}>
        <InterfaceText>{'Dovo Connect + relay'}</InterfaceText>
      </Text>
      {!!snapshot?.internet?.origin && (
        <Text style={styles.muted}>
          <InterfaceText values={{ value0: snapshot.internet.origin }}>
            {'Connect server: {value0}'}
          </InterfaceText>
        </Text>
      )}
      <Text style={styles.muted}>
        {snapshot?.internet?.enabled
          ? snapshot.internet.connected
            ? uiText(
                'Enabled · Online. Same-account devices can connect directly or through encrypted TURN relay.',
              )
            : uiText('Enabled · Connecting to Dovo Connect…')
          : uiText(
              'Enable account access and encrypted TURN fallback on this computer. LAN / VPN pairing stays available.',
            )}
      </Text>
      {snapshot?.internetSetupSupported === undefined ? (
        <Text style={styles.muted}>
          <InterfaceText>
            {'Update Dovo on this computer to enable Connect from a paired device.'}
          </InterfaceText>
        </Text>
      ) : (
        !snapshot.internet?.enabled &&
        snapshot.internetSetupSupported && (
          <>
            {login ? (
              <>
                <Text style={styles.text}>
                  <InterfaceText values={{ value0: login.code }}>
                    {'Confirm code {value0} in your browser.'}
                  </InterfaceText>
                </Text>
                <Action label={uiText('Cancel sign-in')} onPress={client.cancel} />
              </>
            ) : !directory ? (
              <Action
                label={uiText('Sign in to enable Dovo Connect')}
                disabled={!loaded || accountBusy}
                onPress={() => void client.signIn()}
              />
            ) : (
              <Action
                label={busy ? uiText('Enabling…') : uiText('Enable Dovo Connect + relay')}
                disabled={!connected || busy || accountBusy || deletionPending}
                onPress={() =>
                  Alert.alert(
                    uiText('Enable Dovo Connect on {value0}?', { value0: name }),
                    uiText(
                      'Devices signed in as {value0}{value1} will have access to files, agents and terminal commands on this computer. Encrypted traffic may pass through Dovo TURN servers when a direct connection fails.{value2}',
                      {
                        value0: directory.user.name,
                        value1: directory.user.organization
                          ? ` (${directory.user.organization.name})`
                          : '',
                        value2: directory.user.organization
                          ? ' Organization relay settings will be applied automatically unless this computer has a manual TURN override.'
                          : '',
                      },
                    ),
                    [
                      { text: uiText('Cancel'), style: 'cancel' },
                      { text: uiText('Enable Connect + relay'), onPress: () => act(enable) },
                    ],
                  )
                }
              />
            )}
          </>
        )
      )}
      {snapshot?.internet?.enabled &&
        accountServer &&
        !profile.connection.accountSession &&
        !profile.connection.internet && (
          <Action
            label={busy ? uiText('Connecting…') : uiText('Use Dovo Connect fallback')}
            disabled={
              !connected ||
              busy ||
              accountBusy ||
              deletionPending ||
              !accountServer.internet?.online
            }
            onPress={() => act(connectAccount)}
          />
        )}
      {snapshot && (
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>{uiText('Remote MCP')}</Text>
          {!mcp ? (
            <Text style={styles.muted}>
              {uiText('Update Dovo on this computer to configure remote MCP.')}
            </Text>
          ) : (
            <>
              <Text style={styles.muted}>
                {!internet?.enabled
                  ? uiText('Enable Dovo Connect first.')
                  : lanOnly
                    ? uiText('Remote MCP requires a connection mode that allows Dovo Connect.')
                    : mcp.enabled
                      ? uiText(
                          'Remote MCP is enabled on this computer. The Connect server must also support remote MCP.',
                        )
                      : uiText(
                          'Allow external AI apps to request access to this computer through Dovo Connect.',
                        )}
              </Text>
              {!snapshot.internetSetupSupported ? (
                <Text style={styles.muted}>
                  {uiText('Use a separately paired device to change remote MCP access.')}
                </Text>
              ) : (
                <Action
                  label={mcp.enabled ? uiText('Disable remote MCP') : uiText('Enable remote MCP')}
                  disabled={!connected || busy || (!mcp.enabled && (!internet?.enabled || lanOnly))}
                  onPress={() => {
                    if (mcp.enabled) {
                      act(() => setRemoteMcp(false))
                    } else {
                      Alert.alert(
                        uiText('Enable remote MCP'),
                        uiText(
                          'Each app signs in with OAuth. You choose whether it can read or also run agents on this computer.',
                        ),
                        [
                          { text: uiText('Cancel'), style: 'cancel' },
                          {
                            text: uiText('Enable remote MCP'),
                            onPress: () => act(() => setRemoteMcp(true)),
                          },
                        ],
                      )
                    }
                  }}
                />
              )}
              {!!mcp.serverUrl && (
                <>
                  <Text selectable style={styles.muted}>
                    {mcp.serverUrl}
                  </Text>
                  <Action
                    secondary
                    label={
                      copiedUrl === mcp.serverUrl ? uiText('Copied') : uiText('Copy MCP server URL')
                    }
                    onPress={() =>
                      act(async () => {
                        const url = mcp.serverUrl!
                        if (!(await Clipboard.setStringAsync(url)))
                          throw new Error(uiText('Could not copy the MCP server URL'))
                        setCopiedUrl(url)
                      })
                    }
                  />
                </>
              )}
              {!!mcp.managementUrl && (
                <Action
                  secondary
                  label={uiText('Manage connected apps')}
                  onPress={() => act(() => Linking.openURL(mcp.managementUrl!))}
                />
              )}
            </>
          )}
        </View>
      )}
      {!!(error || accountError || snapshot?.internet?.error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || accountError || snapshot?.internet?.error}
        </Text>
      )}
    </View>
  )
}
