import type { PairingInvitation } from '@dovo/protocol'
import { PAIRING_PROTOCOL_VERSION } from '@dovo/protocol'
import { nativeEffect, mobileWorkflow } from './native-effect'
import { Effect } from 'effect'
import { startPolling } from '@dovo/client-runtime'
import { useApplicationState } from './application-state'
import { useEffect, useRef, type ReactNode } from 'react'
import { ActivityIndicator, AppState, Keyboard, Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import {
  normalizeRuntimeAddress,
  runtimeRequest,
  runtimeRequestEffect,
  responses,
} from '@dovo/protocol'
import { useRuntime } from './provider'
import { Action } from '../ui/action'
import { Field } from '../ui/field'
import { colors, styles } from '../ui/theme'
import { Icon } from '../ui/icon'
import { useAction } from '../ui/use-action'
import { ConnectionHelp } from './connection-help'
export function PairComputer({
  onPaired,
  inSheet = false,
  replaceId,
  invitation,
  onBusyChange,
}: {
  onPaired?: () => void
  inSheet?: boolean
  replaceId?: string
  invitation?: PairingInvitation
  onBusyChange?: (busy: boolean) => void
}) {
  const { connect, cancelPairing } = useRuntime(),
    { busy, error, act } = useAction(),
    [address, setAddress] = useApplicationState(invitation?.address ?? ''),
    [name, setName] = useApplicationState('My phone'),
    [computerName, setComputerName] = useApplicationState(''),
    [code, setCode] = useApplicationState(invitation?.code ?? ''),
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
  const pairingPhase = useRef<'waiting' | 'cancelled' | 'saving'>('waiting')
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
      if (AppState.currentState !== 'active') return
      if (Date.parse(pending.expiresAt) <= Date.now()) {
        setPending(null)
        return yield* Effect.fail(
          new Error('Pairing expired. Generate a new code on the computer.'),
        )
      }
      if (pairingPhase.current !== 'waiting') return
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
        setPending(null)
        return yield* Effect.fail(new Error('The computer declined this device'))
      }
      if (result.status === 'approved' && result.token) {
        pairingPhase.current = 'saving'
        setFinishing(true)
        const token = result.token
        yield* Effect.tryPromise({
          try: () =>
            connectRef.current(
              {
                address,
                token,
              },
              computerName.trim() || undefined,
              pending,
              replaceId,
            ),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        }).pipe(Effect.uninterruptible)
        pairingPhase.current = 'waiting'
        if (!stopped) {
          setFinishing(false)
          setPending(null)
          paired.current?.()
        }
      }
    })
    const polling = startPolling(poll, {
      interval: 1500,
      onError: (error) => {
        if (!stopped) {
          if (pairingPhase.current === 'saving') pairingPhase.current = 'waiting'
          setFinishing(false)
          setPairError(error.message)
        }
      },
    })
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') polling.refresh()
    })
    return () => {
      stopped = true
      subscription.remove()
      void polling.stop()
    }
  }, [pending, address, computerName, replaceId])
  const digits = code.length
  const submit = () =>
    act(() =>
      mobileWorkflow(function* () {
        Keyboard.dismiss()
        setPairError('')
        const target = normalizeRuntimeAddress(address)
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
          ),
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
            Scan the QR code with the iPhone Camera, or type the address and code it shows.
          </Step>
        </View>
      )}
      <View style={{ gap: 14 }}>
        <Field
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
        <Field
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
          onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 8))}
          editable={!pending && !busy}
          // No letterSpacing: iOS recycles native inputs and leaks it into other placeholders.
          style={{ fontSize: 20, fontVariant: ['tabular-nums'] }}
        />
      </View>
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
                  pairingPhase.current = 'cancelled'
                  yield* nativeEffect(() => cancelPairing(address, pending)).pipe(
                    Effect.tapError(() =>
                      Effect.sync(() => {
                        pairingPhase.current = 'waiting'
                      }),
                    ),
                  )
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
        <Action secondary label="Dismiss keyboard" onPress={Keyboard.dismiss} />
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
            <Field
              label="Computer name"
              placeholder="Optional · Work Mac, Home server…"
              value={computerName}
              onChangeText={setComputerName}
              editable={!pending && !busy}
              maxLength={80}
            />
            <Field
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
