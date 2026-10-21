import { useEffect, useRef, useState } from 'react'
import { AppState, View } from 'react-native'
import { Effect } from 'effect'
import { startPolling } from '@dovo/client-runtime'
import {
  responses,
  runtimeRequest,
  runtimeRequestEffect,
  type RuntimeProfile,
  type RuntimeConnection,
  type PeerRelayProvider,
} from '@dovo/protocol'
import { mobileWorkflow } from '../state/native-effect'
import { useRuntime } from './provider'
import { PeerRelayChoice } from './peer-relay-choice'
import { useAction } from '../../ui/controls/use-action'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

type Pending = typeof responses.peerUpgrade.Type & { connection: RuntimeConnection }

export function UpgradeInternet({
  profile,
  onBusyChange,
}: {
  profile: RuntimeProfile
  onBusyChange?: (busy: boolean) => void
}) {
  const { styles } = useTheme()
  const { upgradeInternetEffect, connected } = useRuntime()
  const { act, busy, error } = useAction()
  const [relay, setRelay] = useState<PeerRelayProvider>()
  const [pending, setPending] = useState<Pending | null>(null)
  const [message, setMessage] = useState('')
  const [finishing, setFinishing] = useState(false)
  const phase = useRef<'idle' | 'waiting' | 'saving' | 'done' | 'cancelled'>('idle')
  const upgrade = useRef(upgradeInternetEffect)
  upgrade.current = upgradeInternetEffect
  const busyRef = useRef(onBusyChange)
  busyRef.current = onBusyChange
  useEffect(() => {
    busyRef.current?.(busy || !!pending)
  }, [busy, pending])
  useEffect(() => () => busyRef.current?.(false), [])
  useEffect(() => {
    if (!pending) return
    const connection = pending.connection
    let stopped = false
    const fail = (error: Error) => {
      if (stopped) return
      if (phase.current === 'saving') {
        phase.current = 'cancelled'
        void runtimeRequest(
          connection,
          connection.address,
          '/api/runtime/peer/upgrade/cancel',
          { id: pending.id },
          responses.ok,
        ).catch(() =>
          console.warn('Could not cancel the internet request; it will expire automatically.'),
        )
      }
      setMessage(error.message)
      setPending(null)
      setFinishing(false)
    }
    const worker = startPolling(
      mobileWorkflow(function* () {
        if (stopped || AppState.currentState !== 'active' || phase.current !== 'waiting') return
        if (Date.parse(pending.expiresAt) <= Date.now())
          return yield* Effect.fail(new Error('Request expired. Request internet access again.'))
        const result = yield* runtimeRequestEffect(
          connection,
          connection.address,
          '/api/runtime/peer/upgrade/claim',
          { id: pending.id },
          responses.peerUpgrade,
        )
        if (stopped || phase.current !== 'waiting') return
        if (result.status === 'denied')
          return yield* Effect.fail(
            new Error('Internet access was declined. Your existing connection still works.'),
          )
        if (!result.peer) return
        phase.current = 'saving'
        setFinishing(true)
        yield* upgrade.current(profile.id, connection, result.peer)
        phase.current = 'done'
        setPending(null)
        setFinishing(false)
      }),
      { interval: 1000, onError: fail },
    )
    return () => {
      stopped = true
      void worker.stop()
      if (phase.current !== 'done' && phase.current !== 'saving') {
        phase.current = 'cancelled'
        // Best effort on disposal: the server also expires every unanswered request.
        void runtimeRequest(
          connection,
          connection.address,
          '/api/runtime/peer/upgrade/cancel',
          { id: pending.id },
          responses.ok,
        ).catch(() =>
          console.warn('Could not cancel the internet request; it will expire automatically.'),
        )
      }
    }
  }, [pending, profile.id])
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.muted}>
        Enable internet access for this paired computer without scanning another QR. Stay connected
        over LAN or VPN until approval finishes.
      </Text>
      {!pending && <PeerRelayChoice value={relay} onChange={setRelay} disabled={busy} approval />}
      {pending ? (
        <>
          <Text accessibilityRole="text" style={styles.muted}>
            {finishing
              ? 'Testing and saving internet connection…'
              : 'Waiting for approval on the computer. In Dovo, open Settings → Devices & runtime → Trusted devices. On a server, run dovo-server pair devices, then dovo-server pair approve <request-id>.'}
          </Text>
          {!finishing && (
            <Action
              secondary
              label="Cancel internet request"
              disabled={busy}
              onPress={() =>
                act(async () => {
                  phase.current = 'cancelled'
                  setPending(null)
                  setMessage('Request cancelled. Your existing connection still works.')
                  await runtimeRequest(
                    pending.connection,
                    pending.connection.address,
                    '/api/runtime/peer/upgrade/cancel',
                    { id: pending.id },
                    responses.ok,
                  )
                })
              }
            />
          )}
        </>
      ) : (
        <Action
          label="Enable internet connection"
          disabled={busy || !connected}
          onPress={() =>
            act(async () => {
              setMessage('')
              const connection = profile.connection
              const request = await runtimeRequest(
                connection,
                connection.address,
                '/api/runtime/peer/upgrade/request',
                relay ? { relay } : {},
                responses.peerUpgrade,
              )
              phase.current = 'waiting'
              setPending({ ...request, connection })
            })
          }
        />
      )}
      {!!(error || message) && (
        <Text accessibilityRole="alert" style={styles.muted}>
          {error || message}
        </Text>
      )}
    </View>
  )
}
