import { useEffect } from 'react'
import { Alert, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import { responses, runtimeComputerName } from '@dovo/protocol'
import { useRuntime } from './provider'
import { useMobileAccount } from './account-provider'
import { preparePeerConnection } from './peer-transport'
import { useAction } from '../../ui/controls/use-action'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function ConnectSettings({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
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
  const { styles } = useTheme()
  useEffect(() => {
    onBusyChange?.(busy)
    return () => onBusyChange?.(false)
  }, [busy, onBusyChange])
  if (!profile) return null
  const name = runtimeComputerName({ profile, snapshot })
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
    await client.enablePairedInternet(
      snapshot.runtimeId,
      (session) =>
        call(
          '/api/runtime/internet/setup',
          { session, consent: true, relay: 'dovo' },
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
    <View style={{ gap: 8 }} accessibilityLabel={`Dovo Connect for ${name}`}>
      <Text style={styles.title}>Dovo Connect + relay</Text>
      <Text style={styles.muted}>
        {snapshot?.internet?.enabled
          ? snapshot.internet.connected
            ? 'Enabled · Online. Same-account devices can connect directly or through encrypted TURN relay.'
            : 'Enabled · Connecting to Dovo Connect…'
          : 'Enable account access and encrypted TURN fallback on this computer. LAN / VPN pairing stays available.'}
      </Text>
      {snapshot?.internetSetupSupported === undefined ? (
        <Text style={styles.muted}>
          Update Dovo on this computer to enable Connect from a paired device.
        </Text>
      ) : (
        !snapshot.internet?.enabled &&
        snapshot.internetSetupSupported && (
          <>
            {login ? (
              <>
                <Text style={styles.text}>Confirm code {login.code} in your browser.</Text>
                <Action label="Cancel sign-in" onPress={client.cancel} />
              </>
            ) : !directory ? (
              <Action
                label="Sign in to enable Dovo Connect"
                disabled={!loaded || accountBusy}
                onPress={() => void client.signIn()}
              />
            ) : (
              <Action
                label={busy ? 'Enabling…' : 'Enable Dovo Connect + relay'}
                disabled={!connected || busy || accountBusy || deletionPending}
                onPress={() =>
                  Alert.alert(
                    `Enable Dovo Connect on ${name}?`,
                    `Devices signed in as ${directory.user.name}${directory.user.organization ? ` (${directory.user.organization.name})` : ''} will have access to files, agents and terminal commands on this computer. Encrypted traffic may pass through Dovo TURN servers when a direct connection fails.${directory.user.organization ? ' Organization relay settings will be applied automatically unless this computer has a manual TURN override.' : ''}`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Enable Connect + relay', onPress: () => act(enable) },
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
            label={busy ? 'Connecting…' : 'Use Dovo Connect fallback'}
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
      {!!(error || accountError || snapshot?.internet?.error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || accountError || snapshot?.internet?.error}
        </Text>
      )}
    </View>
  )
}
