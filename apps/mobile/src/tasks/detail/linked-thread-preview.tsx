import { View } from 'react-native'
import { clientScopeKey } from '@dovo/client-runtime'
import { linkedThreadPageSchema, type LinkedThreadRead } from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useLinkedThread } from '@dovo/studio-core/linked-thread'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'

export function LinkedThreadPreview({ target }: { target: LinkedThreadRead }) {
  const { connected, read, snapshot, connection } = useRuntime()
  if (!snapshot?.linkedThreadReadSupported) return null
  return (
    <Transcript
      key={clientScopeKey(connection)}
      target={target}
      connected={connected}
      read={(input) => read('/api/threads/linked/read', input, linkedThreadPageSchema)}
    />
  )
}

function Transcript({
  target,
  connected,
  read,
}: {
  target: LinkedThreadRead
  connected: boolean
  read: (input: LinkedThreadRead) => Promise<typeof linkedThreadPageSchema.Type>
}) {
  const uiText = useInterfaceText()
  const { styles } = useTheme()
  const { page, busy, error, refresh, older } = useLinkedThread(target, connected, read)
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.title}>{page?.title ?? uiText('Linked thread preview')}</Text>
      {!connected && <Text style={styles.muted}>{uiText('Parent computer offline.')}</Text>}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {busy && !page && (
        <Text accessibilityLiveRegion="polite">{uiText('Loading linked thread…')}</Text>
      )}
      <Action
        label={uiText('Refresh preview')}
        secondary
        disabled={!connected || busy}
        onPress={refresh}
      />
      {page?.history.before && (
        <Action
          label={uiText('Load earlier messages')}
          secondary
          disabled={!connected || busy}
          onPress={older}
        />
      )}
      {page?.history.messages.map((message) => (
        <View key={message.id} style={{ gap: 4 }}>
          <Text style={styles.muted}>
            {uiText(
              message.role === 'user'
                ? 'You'
                : message.role === 'assistant'
                  ? 'Assistant'
                  : 'System',
            )}
          </Text>
          <Text selectable>{message.text}</Text>
          {message.nextOffset !== undefined && (
            <Text style={styles.muted}>
              {uiText('Message preview. Pair to read the full message.')}
            </Text>
          )}
        </View>
      ))}
    </View>
  )
}
