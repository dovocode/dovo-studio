import { useLayoutEffect, useRef, useState, type ComponentRef } from 'react'
import { AppState, TextInput, View } from 'react-native'
import { taskInputVisible, type RuntimeConnection } from '@dovo/protocol'
import {
  createRuntimeClient,
  sealSecureInput,
  secureInputResultSchema,
  type PendingSecureInput,
  type SecureInputReply,
} from '@dovo/protocol/secure-input'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function TaskSecureInputs({ taskId }: { taskId: string }) {
  const { snapshot, profile, connected } = useRuntime()
  if (!profile) return null
  return (snapshot?.secureInputs ?? [])
    .filter((input) => taskInputVisible(snapshot?.workspace.tasks ?? [], taskId, input))
    .map((input) => (
      <SecureInputCard
        key={`${input.id}:${input.publicKey}:${profile.connection.address}`}
        input={input}
        connection={profile.connection}
        connected={connected}
      />
    ))
}

export function SecureInputCard({
  input,
  connection,
  connected,
}: {
  input: PendingSecureInput
  connection: RuntimeConnection
  connected: boolean
}) {
  const { styles } = useTheme()
  const field = useRef<ComponentRef<typeof TextInput>>(null)
  const value = useRef('')
  const intent = useRef(false)
  const envelope = useRef<SecureInputReply | null>(null)
  const sending = useRef(false)
  const cancelling = useRef(false)
  const epoch = useRef(0)
  const fieldGeneration = useRef(0)
  const [fieldKey, setFieldKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [done, setDone] = useState(false)
  const clear = (resetField = true) => {
    value.current = ''
    intent.current = false
    fieldGeneration.current++
    field.current?.clear()
    if (resetField) setFieldKey(fieldGeneration.current)
  }
  useLayoutEffect(() => {
    epoch.current++
    sending.current = false
    cancelling.current = false
    setDone(false)
    setBusy(false)
    setStatus('')
    clear()
    envelope.current = null
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') clear()
    })
    return () => {
      epoch.current++
      clear(false)
      envelope.current = null
      subscription.remove()
    }
  }, [connection, input.id, input.publicKey])
  const act = async (cancel: boolean, text = value.current) => {
    if (!connected || done || (cancel ? cancelling.current : sending.current)) return
    if (cancel) cancelling.current = true
    // Cancellation supersedes a pending submission, including its late response.
    const attempt = ++epoch.current
    sending.current = true
    setBusy(true)
    setStatus('')
    try {
      const check = !cancel && input.status === 'running' && !envelope.current
      if (!cancel && !check && !envelope.current) envelope.current = sealSecureInput(input, text)
      clear()
      text = ''
      const result = await createRuntimeClient(connection).request(
        cancel
          ? '/api/secure-input/cancel'
          : check
            ? '/api/secure-input/status'
            : '/api/secure-input/submit',
        cancel || check ? { taskId: input.taskId, id: input.id } : envelope.current,
        secureInputResultSchema,
        { timeoutMs: 70_000 },
      )
      if (attempt !== epoch.current) return
      setStatus(`Secure input ${result.status}.`)
      if (!['running', 'pending'].includes(result.status)) {
        envelope.current = null
        setDone(true)
      }
    } catch {
      if (attempt !== epoch.current) return
      clear()
      setStatus(
        cancel
          ? 'Cancellation is not confirmed. Reconnect and try again.'
          : envelope.current
            ? 'Delivery is not confirmed. Retry to check the same submission.'
            : input.status === 'running'
              ? 'Status is not available. Reconnect and check again.'
              : 'Enter a private value of at most 8192 UTF-8 bytes.',
      )
    } finally {
      if (attempt === epoch.current) {
        if (cancel) cancelling.current = false
        sending.current = false
        setBusy(false)
      }
    }
  }
  const submit = () => {
    if (sending.current || intent.current || !connected) return
    if (!envelope.current && field.current?.isFocused()) {
      // Use native end-editing text, not a potentially delayed onChangeText value.
      intent.current = true
      field.current.blur()
    } else void act(false)
  }
  const destination = input.destination
  return (
    <View style={[styles.card, { marginHorizontal: 16, marginBottom: 12, padding: 12, gap: 10 }]}>
      <Text style={styles.text}>Secure input · {input.title}</Text>
      <Text style={styles.text}>{input.prompt}</Text>
      <Text style={styles.muted}>
        Only this runtime receives the value. The agent receives status only. Input is not saved.
      </Text>
      {destination.kind === 'command' ? (
        <>
          <Text style={styles.text}>
            Run:{' '}
            {[destination.command, ...destination.args].map((arg) => JSON.stringify(arg)).join(' ')}
          </Text>
          <Text style={styles.muted}>Folder: {input.directory}</Text>
          <Text style={styles.muted}>
            Use stdin{destination.appendNewline ? ' with a trailing newline' : ' as entered'}.
            Output is discarded. Trust this command before you submit.
          </Text>
        </>
      ) : (
        <Text style={styles.text}>
          Complete the active sign-in for ACP installation: {destination.installationId}
        </Text>
      )}
      <Text style={styles.muted}>Expires: {new Date(input.expiresAt).toLocaleTimeString()}</Text>
      <Text style={styles.muted}>Private value</Text>
      <TextInput
        key={fieldKey}
        ref={field}
        accessibilityLabel="Private value"
        secureTextEntry
        autoComplete="off"
        textContentType="none"
        autoCorrect={false}
        spellCheck={false}
        autoCapitalize="none"
        importantForAutofill="noExcludeDescendants"
        editable={connected && !busy && !done && input.status === 'pending' && !envelope.current}
        returnKeyType="send"
        style={styles.input}
        onChangeText={(text) => {
          if (
            fieldGeneration.current !== fieldKey ||
            AppState.currentState !== 'active' ||
            sending.current
          )
            return
          value.current = text
        }}
        onEndEditing={(event) => {
          if (fieldGeneration.current !== fieldKey || AppState.currentState !== 'active') return
          const text = event.nativeEvent.text
          value.current = text
          if (intent.current) {
            intent.current = false
            void act(false, text)
          }
        }}
        onSubmitEditing={(event) => {
          if (fieldGeneration.current !== fieldKey || AppState.currentState !== 'active') return
          intent.current = false
          void act(false, event.nativeEvent.text)
        }}
      />
      <Action
        label={
          busy
            ? 'Sending…'
            : envelope.current || input.status === 'running'
              ? 'Check submission'
              : destination.kind === 'command'
                ? 'Submit and run privately'
                : 'Submit callback privately'
        }
        disabled={!connected || busy || done}
        onPress={submit}
      />
      <Action
        secondary
        label="Cancel secure input"
        disabled={!connected || done}
        onPress={() => void act(true)}
      />
      {!connected && (
        <Text accessibilityRole="status" style={styles.muted}>
          Reconnect to submit. Private input is never queued.
        </Text>
      )}
      {!!status && (
        <Text accessibilityRole="status" style={styles.muted}>
          {status}
        </Text>
      )}
    </View>
  )
}
