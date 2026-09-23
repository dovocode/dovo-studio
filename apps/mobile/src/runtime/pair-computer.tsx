import type { PairingInvitation } from '@dovo/protocol'
import { PAIRING_PROTOCOL_VERSION } from '@dovo/protocol'
import { nativeEffect, mobileWorkflow } from './native-effect'
import { Effect } from 'effect'
import { startPolling } from '@dovo/client-runtime'
import { useApplicationState } from './application-state'
import { useEffect, useRef } from 'react'
import { ActivityIndicator, AppState, Keyboard, Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { runtimeRequest, runtimeRequestEffect, responses } from '@dovo/protocol'
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
  return (
    <View
      style={{
        gap: 16,
      }}
    >
      <Text style={styles.muted}>
        {replaceId
          ? 'Enter the new address and a fresh pairing code from the same computer. Your saved connection stays unchanged until pairing succeeds.'
          : 'On your Mac, open Settings → Devices & runtime → Manage → Connect your phone. Scan the QR code with the iPhone Camera, or enter the address and code below.'}
      </Text>
      <Field
        label="Runtime address"
        placeholder="http://100.x.x.x:51464"
        keyboardType="url"
        autoCorrect={false}
        autoComplete="off"
        value={address}
        onChangeText={setAddress}
        editable={!pending && !busy}
      />
      <Pressable
        testID="Pairing options"
        accessibilityLabel="Pairing options"
        accessibilityRole="button"
        accessibilityState={{
          expanded: options,
        }}
        onPress={() => setOptions(!options)}
        style={[
          styles.row,
          {
            minHeight: 44,
          },
        ]}
      >
        <Text
          style={[
            styles.text,
            {
              flex: 1,
              color: colors.accent,
            },
          ]}
        >
          Pairing options
        </Text>
        <Icon name={options ? 'down' : 'next'} size={13} color={colors.muted} />
      </Pressable>
      {options && (
        <>
          <Field
            label="Computer name"
            placeholder="Optional · Work Mac, Home server…"
            value={computerName}
            onChangeText={setComputerName}
            editable={!pending && !busy}
            maxLength={80}
          />
          <Field
            label="Device name"
            value={name}
            onChangeText={setName}
            editable={!pending && !busy}
            maxLength={100}
          />
        </>
      )}
      <Field
        label="Pairing code"
        placeholder="8 digits from the computer"
        keyboardType="number-pad"
        value={code}
        onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 8))}
        editable={!pending && !busy}
      />
      {keyboard && !inSheet && (
        <Action secondary label="Dismiss keyboard" onPress={Keyboard.dismiss} />
      )}
      <Action
        label={finishing ? 'Saving connection…' : pending ? 'Checking pairing…' : 'Pair device'}
        disabled={busy || !!pending || !/^\d{8}$/.test(code) || !name.trim() || !address.trim()}
        onPress={() =>
          act(() =>
            mobileWorkflow(function* () {
              Keyboard.dismiss()
              setPairError('')
              const target = address.trim()
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
        }
      />
      {pending && (
        <View
          style={[
            styles.card,
            {
              gap: 12,
            },
          ]}
        >
          <View
            style={[
              styles.row,
              {
                flexWrap: 'nowrap',
              },
            ]}
          >
            <ActivityIndicator color={colors.accent} />
            <Text
              style={[
                styles.text,
                {
                  flex: 1,
                },
              ]}
            >
              Waiting for your computer
            </Text>
          </View>
          <Text style={styles.muted}>
            Keep this screen open and the computer online. Approve this phone on the computer to
            finish pairing.
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
      )}
      {!!(error || pairError) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || pairError}
        </Text>
      )}
      <Pressable
        testID="Connection help"
        accessibilityLabel="Connection help"
        accessibilityRole="button"
        accessibilityState={{
          expanded: help,
        }}
        onPress={() => setHelp(!help)}
        style={[
          styles.row,
          {
            minHeight: 44,
          },
        ]}
      >
        <Text
          style={[
            styles.text,
            {
              flex: 1,
              color: colors.accent,
            },
          ]}
        >
          {error || pairError ? 'Trouble connecting?' : 'How to connect'}
        </Text>
        <Icon name={help ? 'down' : 'next'} size={13} color={colors.muted} />
      </Pressable>
      {help && <ConnectionHelp pairing />}
    </View>
  )
}
