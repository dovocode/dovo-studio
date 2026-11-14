import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { responses, type RuntimeProfile, type TerminalInfo } from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../runtime/connection/provider'
import { Sheet } from '../ui/layout/sheet'
import { Field } from '../ui/controls/field'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'

type TerminalRenameProps = {
  session: TerminalInfo
  owner?: { profile: RuntimeProfile; connected: boolean }
  onClose: () => void
}

export function TerminalRename(props: TerminalRenameProps) {
  const runtime = useRuntime()
  return (
    <RenameEditor
      key={JSON.stringify([
        props.owner?.profile.connection ?? runtime.connection,
        props.session.id,
      ])}
      {...props}
    />
  )
}

function RenameEditor({ session, owner, onClose }: TerminalRenameProps) {
  const runtime = useRuntime()
  const connected = owner?.connected ?? runtime.connected
  const uiText = useInterfaceText()
  const { styles } = useTheme()
  const [title, setTitle] = useState(session.customTitle ?? session.title)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const save = async (next: string | null) => {
    if (locked.current || !connected) return
    locked.current = true
    setPending(true)
    setError('')
    try {
      const input = { id: session.id, title: next }
      if (owner)
        await runtime.readRuntime(owner.profile, '/api/terminals/update', input, responses.terminal)
      else await runtime.call('/api/terminals/update', input, responses.terminal)
      if (!mounted.current) return
      try {
        if (owner) await runtime.refreshRuntime(owner.profile)
        else await runtime.refresh()
      } catch (cause) {
        throw new Error(
          `Terminal renamed, but its status could not refresh: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }
      if (mounted.current) onClose()
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      locked.current = false
      if (mounted.current) setPending(false)
    }
  }
  return (
    <Sheet title="Rename terminal" busy={pending} onClose={onClose}>
      <Text style={styles.muted}>
        Choose a name, or let the shell and its programs update it automatically.
      </Text>
      <Field
        label="Terminal title"
        value={title}
        onChangeText={setTitle}
        maxLength={256}
        autoFocus
        autoCapitalize="sentences"
        autoCorrect={false}
        editable={!pending}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (title.trim()) void save(title.trim())
        }}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        <Action
          secondary
          label="Use automatic title"
          disabled={pending || !connected}
          onPress={() => void save(null)}
        />
        <Action secondary label={uiText('Cancel')} disabled={pending} onPress={onClose} />
        <Action
          label={uiText('Save')}
          disabled={pending || !connected || !title.trim()}
          onPress={() => void save(title.trim())}
        />
      </View>
    </Sheet>
  )
}
