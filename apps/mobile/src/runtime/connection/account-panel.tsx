import { useState, useEffect, useRef } from 'react'
import { Alert, View } from 'react-native'
import { useMobileAccount } from './account-provider'
import * as Crypto from 'expo-crypto'
import { preparePeerConnection } from './peer-transport'
import { runtimeComputerName, accountServerAddresses, type AccountServer } from '@dovo/protocol'
import { useRuntime } from './provider'
import { Text } from '../../ui/content/text'
import { SettingsChoice as Choice } from '../../screens/settings-controls'
import { SettingsAction as Action } from '../../screens/settings-controls'
import { useSettingsTheme } from '../../screens/settings-theme'
export function AccountPanel({ onPair }: { onPair: (address: string) => void }) {
  const { client, directory, login, busy, error, loaded, deletionPending } = useMobileAccount()
  const { overviews, connect } = useRuntime()
  const [connecting, setConnecting] = useState<string | null>(null)
  const [connectionError, setConnectionError] = useState('')
  const [linkedOpen, setLinkedOpen] = useState(false)
  useEffect(() => setLinkedOpen(false), [directory?.user.id])
  const attempt = useRef<AbortController | null>(null)
  useEffect(() => () => attempt.current?.abort(), [])
  const connectComputer = async (server: AccountServer) => {
    if (attempt.current) return
    const controller = new AbortController()
    attempt.current = controller
    setConnecting(server.id)
    setConnectionError('')
    try {
      const connection = await client.connectInternet(
        server,
        Crypto.getRandomBytes(32),
        controller.signal,
      )
      if (!connection.peer) throw new Error('Computer did not provide an encrypted connection')
      preparePeerConnection(connection.peer)
      await connect(connection, server.name)
    } catch (error) {
      if (!controller.signal.aborted)
        setConnectionError(error instanceof Error ? error.message : 'Could not connect')
    } finally {
      if (attempt.current === controller) attempt.current = null
      setConnecting(null)
    }
  }
  const [selected, setSelected] = useState<Record<string, string>>({})
  const { styles } = useSettingsTheme()
  return (
    <View style={{ gap: 12 }} accessibilityLabel="Dovo account">
      <Text style={styles.title}>
        {directory ? `Signed in as ${directory.user.name}` : 'Your computers, across devices'}
      </Text>
      <Text style={styles.text}>
        Use the same account as your computer for Dovo Connect. No pairing code needed. LAN / VPN
        pairing is separate and takes priority when available.
      </Text>
      {!!connectionError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {connectionError}
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {login ? (
        <>
          <Text accessibilityRole="alert" style={styles.text}>
            Confirm code {login.code} in your browser.
          </Text>
          <Action label="Cancel sign-in" onPress={client.cancel} />
        </>
      ) : deletionPending ? (
        <Action
          label="Retry account deletion"
          disabled={busy}
          onPress={() => void client.deleteAccount()}
        />
      ) : directory ? (
        <>
          <Action
            label="Refresh linked computers"
            disabled={busy}
            onPress={() => void client.refresh()}
          />
          <Action label="Sign out" disabled={busy} onPress={() => void client.signOut()} />
          <Action
            label="Delete account"
            disabled={busy}
            onPress={() =>
              Alert.alert(
                'Delete your Dovo account?',
                'This permanently deletes your hosted identity, linked computers and notification permissions on all devices. Files, threads and separate pairings on your computers remain. Service backups expire within 14 days. This cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete account',
                    style: 'destructive',
                    onPress: () => void client.deleteAccount(),
                  },
                ],
              )
            }
          />
        </>
      ) : (
        <Action
          label={busy ? 'Connecting…' : 'Sign in'}
          disabled={busy || !loaded}
          onPress={() => void client.signIn()}
        />
      )}
      {!!error && (
        <Action label="Retry account" disabled={busy} onPress={() => void client.load()} />
      )}
      {directory && !deletionPending && (
        <>
          <Action
            secondary
            label={linkedOpen ? 'Hide linked computers' : 'Manage linked computers'}
            onPress={() => setLinkedOpen((open) => !open)}
          />
          {linkedOpen && (
            <View style={{ gap: 12 }} accessibilityLabel="Linked computers">
              {!directory.servers.length && (
                <Text style={styles.text}>
                  Enable Dovo Connect on your computer to see it here, or link a separately paired
                  computer below.
                </Text>
              )}
              {directory.servers.map((server) => {
                const paired = overviews.some(
                  (source) =>
                    source.profile.connection.runtimeId === server.id ||
                    source.snapshot?.runtimeId === server.id,
                )
                return (
                  <View key={server.id} style={{ gap: 8 }}>
                    <Text style={styles.title}>{server.name}</Text>
                    <Text style={styles.text}>
                      {server.internet
                        ? server.internet.online
                          ? 'Dovo Connect · Online'
                          : 'Dovo Connect · Offline'
                        : server.address}
                    </Text>
                    {server.internet ? (
                      <Action
                        label={
                          connecting === server.id
                            ? 'Connecting…'
                            : `${paired ? 'Reconnect' : 'Connect'} ${server.name}`
                        }
                        disabled={busy || !!connecting || !server.internet.online}
                        onPress={() => void connectComputer(server)}
                      />
                    ) : paired ? (
                      <Text style={styles.text}>Already paired</Text>
                    ) : (
                      <Action
                        label={`Pair ${server.name}`}
                        disabled={busy}
                        onPress={() => onPair(server.address)}
                      />
                    )}
                    <Action
                      label={
                        server.internet
                          ? `Disable Dovo Connect for ${server.name}`
                          : `Unlink ${server.name}`
                      }
                      disabled={busy}
                      onPress={() => void client.unlink(server.id)}
                    />
                  </View>
                )
              })}
              {overviews
                .filter(
                  (source) =>
                    source.connected &&
                    source.snapshot?.runtimeId &&
                    !directory.servers.some((server) => server.id === source.snapshot?.runtimeId),
                )
                .map((source) => {
                  const id = source.snapshot?.runtimeId,
                    name = runtimeComputerName(source)
                  const addresses = accountServerAddresses(
                    source.profile.connection,
                    source.snapshot,
                  )
                  const address = addresses.includes(selected[source.profile.id])
                    ? selected[source.profile.id]
                    : addresses[0]
                  return (
                    <View key={source.profile.id} style={{ gap: 8 }}>
                      {addresses.length > 1 && (
                        <Choice
                          label={`Address for ${name}`}
                          value={address}
                          items={addresses.map((value) => ({ id: value, name: value }))}
                          disabled={busy}
                          onChange={(value) =>
                            setSelected((current) => ({ ...current, [source.profile.id]: value }))
                          }
                        />
                      )}
                      {address ? (
                        <>
                          <Text style={styles.text}>{address}</Text>
                          <Action
                            label={`Link ${name} to account`}
                            disabled={busy}
                            onPress={() => {
                              if (id) void client.link({ id, name, address })
                            }}
                          />
                        </>
                      ) : (
                        <Text style={styles.text}>
                          Enable LAN/VPN access on {name} before linking it.
                        </Text>
                      )}
                    </View>
                  )
                })}
            </View>
          )}
        </>
      )}
    </View>
  )
}
