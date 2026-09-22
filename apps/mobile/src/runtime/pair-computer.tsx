import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Keyboard, Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { runtimeRequest, responses } from '@dovo/protocol'
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
}: {
  onPaired?: () => void
  inSheet?: boolean
}) {
  const { connect } = useRuntime(),
    { busy, error, act } = useAction(),
    [address, setAddress] = useState(''),
    [name, setName] = useState('My phone'),
    [computerName, setComputerName] = useState(''),
    [code, setCode] = useState(''),
    [options, setOptions] = useState(false),
    [help, setHelp] = useState(false),
    [keyboard, setKeyboard] = useState(false),
    [pairError, setPairError] = useState(''),
    [pending, setPending] = useState<{ id: string; secret: string; expiresAt: string } | null>(null)
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
    let stopped = false,
      polling = false
    const poll = async () => {
      if (polling || stopped || AppState.currentState !== 'active') return
      polling = true
      try {
        if (Date.parse(pending.expiresAt) <= Date.now())
          throw new Error('Pairing expired. Generate a new code on the computer.')
        const result = await runtimeRequest(
          null,
          address,
          '/api/pair/claim',
          { id: pending.id, secret: pending.secret },
          responses.pairClaim,
        )
        if (stopped) return
        setPairError('')
        if (result.status === 'denied') {
          setPending(null)
          throw new Error('The computer declined this device')
        }
        if (result.status === 'approved' && result.token) {
          await connect({ address, token: result.token }, computerName.trim() || undefined)
          if (!stopped) {
            setPending(null)
            paired.current?.()
          }
        }
      } catch (error) {
        if (!stopped) {
          setPairError(error instanceof Error ? error.message : String(error))
          if (Date.parse(pending.expiresAt) <= Date.now()) setPending(null)
        }
      } finally {
        polling = false
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 1500)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void poll()
    })
    return () => {
      stopped = true
      clearInterval(timer)
      subscription.remove()
    }
  }, [pending, address, computerName, connect])
  return (
    <View style={{ gap: 16 }}>
      <Text style={styles.muted}>Enter the address and pairing code shown on your computer.</Text>
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
        accessibilityState={{ expanded: options }}
        onPress={() => setOptions(!options)}
        style={[styles.row, { minHeight: 44 }]}
      >
        <Text style={[styles.text, { flex: 1, color: colors.accent }]}>Pairing options</Text>
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
        onChangeText={setCode}
        maxLength={8}
        editable={!pending && !busy}
      />
      {keyboard && !inSheet && (
        <Action secondary label="Dismiss keyboard" onPress={Keyboard.dismiss} />
      )}
      <Action
        label={pending ? 'Checking pairing…' : 'Pair device'}
        disabled={busy || !!pending || !/^\d{8}$/.test(code) || !name.trim() || !address.trim()}
        onPress={() =>
          act(async () => {
            Keyboard.dismiss()
            setPairError('')
            const target = address.trim()
            setAddress(target)
            setPending(
              await runtimeRequest(
                null,
                target,
                '/api/pair/request',
                { code, name: name.trim() },
                responses.pairRequest,
              ),
            )
          })
        }
      />
      {pending && (
        <View style={[styles.card, { gap: 12 }]}>
          <View style={[styles.row, { flexWrap: 'nowrap' }]}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.text, { flex: 1 }]}>Waiting for your computer</Text>
          </View>
          <Text style={styles.muted}>
            Keep the computer online. If approval is requested there, approve this phone to finish
            pairing.
          </Text>
          <Action secondary label="Cancel pairing" onPress={() => setPending(null)} />
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
        accessibilityState={{ expanded: help }}
        onPress={() => setHelp(!help)}
        style={[styles.row, { minHeight: 44 }]}
      >
        <Text style={[styles.text, { flex: 1, color: colors.accent }]}>
          {error || pairError ? 'Trouble connecting?' : 'How to connect'}
        </Text>
        <Icon name={help ? 'down' : 'next'} size={13} color={colors.muted} />
      </Pressable>
      {help && <ConnectionHelp pairing />}
    </View>
  )
}
