import { PairingField } from './pairing-field'
import { finalizePairing } from './pair-finalization'
import { PairingScanner } from './pairing-scanner'
import { PeerRelayChoice } from './peer-relay-choice'
import { preparePeerConnection, forgetPeerConnection } from './peer-transport'
import {
  peerConfigSchema,
  peerAddress,
  type PeerConfig,
  PAIRING_PROTOCOL_VERSION,
  createRuntimeClient,
  pairingAddress,
  runtimeRequest,
  runtimeRequestEffect,
  responses,
  type PairingInvitation,
} from '@dovo/protocol'
import { nativeEffect, mobileWorkflow } from '../state/native-effect'
import { Effect } from 'effect'
import { startPolling } from '@dovo/client-runtime'
import { useApplicationState } from '../state/application-state'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, AppState, Keyboard, Pressable, View } from 'react-native'
import { Text } from '../../ui/content/text'
import { useRuntime } from './provider'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'
import { Icon } from '../../ui/controls/icon'
import { useAction } from '../../ui/controls/use-action'
import { ConnectionHelp } from './connection-help'
export function PairComputer({
  onPaired,
  inSheet = false,
  replaceId,
  invitation,
  initialAddress,
  onBusyChange,
}: {
  onPaired?: () => void
  inSheet?: boolean
  replaceId?: string
  initialAddress?: string
  invitation?: PairingInvitation
  onBusyChange?: (busy: boolean) => void
}) {
  const { colors, styles } = useTheme()

  const { connect, cancelPairing } = useRuntime(),
    { busy, error, act } = useAction(),
    [address, setAddress] = useState(invitation?.address ?? initialAddress ?? ''),
    [peer, setPeer] = useApplicationState<PeerConfig | undefined>(invitation?.peer),
    [name, setName] = useState('My phone'),
    [computerName, setComputerName] = useState(''),
    [code, setCode] = useState(invitation?.code ?? ''),
    [inputRevision, setInputRevision] = useState(0),
    [options, setOptions] = useApplicationState(false),
    [help, setHelp] = useApplicationState(false),
    [keyboard, setKeyboard] = useApplicationState(false),
    [pairError, setPairError] = useApplicationState(''),
    [finishing, setFinishing] = useApplicationState(false),
    [pending, setPending] = useApplicationState<{
      id: string
      secret: string
      expiresAt: string
    } | null>(null)
  useEffect(() => {
    onBusyChange?.(busy || !!pending || finishing)
  }, [busy, pending, finishing, onBusyChange])
  const [scanning, setScanning] = useApplicationState(false)
  const pairingPhase = useRef<'waiting' | 'cancelled' | 'saving'>('waiting')
  const bootstrap = useRef<string | undefined>(undefined)
  const forgetBootstrap = () => {
    if (bootstrap.current) forgetPeerConnection(bootstrap.current)
    bootstrap.current = undefined
  }
  useEffect(() => () => forgetBootstrap(), [])
  const connectRef = useRef(connect)
  connectRef.current = connect
  const paired = useRef(onPaired)
  paired.current = onPaired
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  useEffect(() => {
    if (!pending) return
    pairingPhase.current = 'waiting'
    let stopped = false
    const poll = mobileWorkflow(function* () {
      if (AppState.currentState !== 'active' || pairingPhase.current !== 'waiting') return
      if (Date.parse(pending.expiresAt) <= Date.now()) {
        forgetBootstrap()
        setPending(null)
        return yield* Effect.fail(
          new Error('Pairing expired. Generate a new code on the computer.'),
        )
      }
      const result = yield* runtimeRequestEffect(
        null,
        address,
        '/api/pair/claim',
        {
          id: pending.id,
          secret: pending.secret,
        },
        responses.pairClaim,
      )
      if (stopped || pairingPhase.current !== 'waiting') return
      setPairError('')
      if (result.status === 'denied') {
        forgetBootstrap()
        setPending(null)
        return yield* Effect.fail(new Error('The computer declined this device'))
      }
      if (result.status === 'approved' && result.token) {
        pairingPhase.current = 'saving'
        setFinishing(true)
        const token = result.token
        yield* finalizePairing(
          mobileWorkflow(function* () {
            // The bootstrap capability is replaced only after approval.
            const enabled = peer
              ? yield* createRuntimeClient({ address, token, peer }).requestEffect(
                  '/api/runtime/peer/enable',
                  {},
                  peerConfigSchema,
                )
              : undefined
            const permanent = enabled
              ? { ...enabled, ...(peer?.relay ? { relay: peer.relay } : {}) }
              : undefined
            if (permanent) preparePeerConnection(permanent)
            yield* nativeEffect(() =>
              connectRef.current(
                {
                  address: permanent ? peerAddress(permanent) : address,
                  token,
                  ...(permanent ? { peer: permanent } : {}),
                },
                computerName.trim() || undefined,
                pending,
                replaceId,
                address,
              ),
            )
            forgetBootstrap()
            pairingPhase.current = 'waiting'
            if (!stopped) {
              setFinishing(false)
              setPending(null)
              paired.current?.()
            }
          }),
          (error) => {
            // The enable or save may have reached the computer. Require an explicit
            // cancellation/new pairing rather than replaying an uncertain mutation.
            pairingPhase.current = 'cancelled'
            if (!stopped) {
              setFinishing(false)
              setPairError(
                `Could not finish pairing: ${error.message} Check your saved computers before cancelling or trying a new code.`,
              )
            }
          },
        )
      }
    })
    const start = () =>
      startPolling(poll, {
        interval: 1500,
        onError: (error) => {
          if (!stopped) {
            if (pairingPhase.current === 'saving') pairingPhase.current = 'waiting'
            setFinishing(false)
            setPairError(error.message)
          }
        },
      })
    let polling = AppState.currentState === 'active' ? start() : undefined
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        void polling?.stop()
        polling = undefined
      } else if (!polling) polling = start()
    })
    return () => {
      stopped = true
      subscription.remove()
      void polling?.stop()
    }
  }, [pending, address, computerName, replaceId, peer])
  const digits = code.length
  const submit = () =>
    act(() =>
      mobileWorkflow(function* () {
        Keyboard.dismiss()
        setPairError('')
        const target = pairingAddress(address)
        if (peer) bootstrap.current = preparePeerConnection(peer)
        setAddress(target)
        setPending(
          yield* nativeEffect(() =>
            runtimeRequest(
              null,
              target,
              '/api/pair/request',
              {
                protocolVersion: PAIRING_PROTOCOL_VERSION,
                code,
                name: name.trim(),
              },
              responses.pairRequest,
            ),
          ).pipe(Effect.tapError(() => Effect.sync(forgetBootstrap))),
        )
      }),
    )
  return (
    <View style={{ gap: 20 }}>
      {replaceId ? (
        <Text style={styles.muted}>
          Enter the new address and a fresh pairing code from the same computer. Your saved
          connection stays unchanged until pairing succeeds.
        </Text>
      ) : (
        <View style={{ gap: 12 }}>
          <Step number={1}>
            On your computer, open Dovo and choose{' '}
            <Text style={{ color: colors.text, fontWeight: '600' }}>Connect your phone</Text> in
            Settings → Devices & runtime.
          </Step>
          <Step number={2}>
            Scan the QR code in this app to connect over the internet. No VPN or local IP needed.
            You can also pair using a LAN / VPN address.
          </Step>
        </View>
      )}
      {!pending && (
        <Action
          secondary
          label="Scan pairing QR code"
          disabled={busy || finishing}
          onPress={() => {
            Keyboard.dismiss()
            setScanning(true)
          }}
        />
      )}
      {scanning && (
        <PairingScanner
          onClose={() => setScanning(false)}
          onScanned={(invitation) => {
            setAddress(invitation.address)
            setPeer(invitation.peer)
            setCode(invitation.code)
            setInputRevision((revision) => revision + 1)
            setPairError('')
            setScanning(false)
          }}
        />
      )}
      {peer ? (
        <View style={[styles.card, { gap: 6 }]}>
          <Text>Internet connection</Text>
          <Text style={styles.muted}>
            WebRTC + STUN · end-to-end encrypted. No VPN or computer address needed. Keep Dovo open
            on the computer.
          </Text>
          <PeerRelayChoice
            value={peer.relay}
            disabled={!!pending || busy}
            onChange={(relay) => setPeer({ ...peer, relay })}
          />
          <Action
            secondary
            label="Use a LAN / VPN address instead"
            disabled={!!pending || busy}
            onPress={() => {
              setPeer(undefined)
              setAddress('')
              setCode('')
              setInputRevision((revision) => revision + 1)
            }}
          />
        </View>
      ) : (
        <View style={{ gap: 14 }}>
          <PairingField
            key={`address:${inputRevision}`}
            label="Computer address"
            placeholder="192.168.1.20:51464"
            hint="Wi-Fi, Tailscale and NetBird addresses all work. Include the port."
            keyboardType="url"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="next"
            value={address}
            onChangeText={setAddress}
            editable={!pending && !busy}
          />
          <PairingField
            key={`code:${inputRevision}`}
            label="Pairing code"
            placeholder="8-digit code"
            hint={
              digits && digits < 8
                ? `${8 - digits} more digit${8 - digits === 1 ? '' : 's'}`
                : 'Codes expire after two minutes.'
            }
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            value={code}
            normalize={(value) => value.replace(/\D/g, '').slice(0, 8)}
            onChangeText={setCode}
            editable={!pending && !busy}
            // No letterSpacing: iOS recycles native inputs and leaks it into other placeholders.
            style={{ fontSize: 20, fontVariant: ['tabular-nums'] }}
          />
        </View>
      )}
      {!!(error || pairError) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || pairError}
        </Text>
      )}
      {pending ? (
        <View style={[styles.card, { gap: 12 }]}>
          <View style={[styles.row, { flexWrap: 'nowrap' }]}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.text, { flex: 1, fontWeight: '600' }]}>
              {finishing ? 'Saving connection…' : 'Waiting for your computer'}
            </Text>
          </View>
          <Text style={styles.muted}>
            Keep this screen open and the computer online. If your computer asks, approve this phone
            there to finish.
          </Text>
          <Action
            secondary
            label="Cancel pairing"
            disabled={busy || finishing}
            onPress={() =>
              act(() =>
                mobileWorkflow(function* () {
                  if (pairingPhase.current === 'saving') return
                  const previousPhase = pairingPhase.current
                  pairingPhase.current = 'cancelled'
                  yield* nativeEffect(() => cancelPairing(address, pending)).pipe(
                    Effect.tapError(() =>
                      Effect.sync(() => {
                        pairingPhase.current = previousPhase
                      }),
                    ),
                  )
                  forgetBootstrap()
                  setPending(null)
                }),
              )
            }
          />
        </View>
      ) : (
        <Action
          wide
          label={busy ? 'Connecting…' : 'Connect'}
          disabled={busy || digits !== 8 || !name.trim() || !address.trim()}
          onPress={submit}
        />
      )}
      {keyboard && !inSheet && (
        <Action secondary label="Dismiss keyboard" onPress={() => Keyboard.dismiss()} />
      )}
      <View>
        <Disclosure
          label="Name this computer and phone"
          testID="Pairing options"
          open={options}
          onToggle={() => setOptions(!options)}
        />
        {options && (
          <View style={{ gap: 14, paddingBottom: 8 }}>
            <PairingField
              label="Computer name"
              placeholder="Optional · Work Mac, Home server…"
              value={computerName}
              onChangeText={setComputerName}
              editable={!pending && !busy}
              maxLength={80}
            />
            <PairingField
              label="This phone’s name"
              hint="Shown on your computer’s list of paired devices."
              value={name}
              onChangeText={setName}
              editable={!pending && !busy}
              maxLength={100}
            />
          </View>
        )}
        <Disclosure
          label={error || pairError ? 'Trouble connecting?' : 'How to connect'}
          testID="Connection help"
          open={help}
          onToggle={() => setHelp(!help)}
        />
        {help && <ConnectionHelp pairing />}
      </View>
    </View>
  )
}
function Step({ number, children }: { number: number; children: ReactNode }) {
  const { colors, styles } = useTheme()

  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: 'rgba(165, 180, 252, 0.16)',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
      >
        <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '700' }}>{number}</Text>
      </View>
      <Text style={[styles.muted, { flex: 1, fontSize: 15, lineHeight: 21 }]}>{children}</Text>
    </View>
  )
}
function Disclosure({
  label,
  testID,
  open,
  onToggle,
}: {
  label: string
  testID: string
  open: boolean
  onToggle: () => void
}) {
  const { colors, styles } = useTheme()

  return (
    <Pressable
      testID={testID}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={({ pressed }) => [styles.row, { minHeight: 44, opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.text, { flex: 1, color: colors.accent, fontSize: 15 }]}>{label}</Text>
      <Icon name={open ? 'down' : 'next'} size={13} color={colors.muted} />
    </Pressable>
  )
}
