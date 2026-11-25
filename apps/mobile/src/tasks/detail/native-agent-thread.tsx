import { useNativeThreadHistory } from '@dovo/studio-core'
import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { Image, ScrollView, View } from 'react-native'
import { subagentMetadata, type Subagent } from '@dovo/protocol'
import { ScreenHeader } from '../../ui/layout/screen-header'
import { Text } from '../../ui/content/text'
import { Markdown } from '../../ui/content/markdown'
import { Action } from '../../ui/controls/action'
import { useRuntime } from '../../runtime/connection/provider'
import { useTheme } from '../../ui/theme'

export function NativeAgentThread({
  taskId,
  agent,
  onClose,
  parentTitle,
}: {
  taskId: string
  agent: Subagent
  onClose: () => void
  parentTitle?: string
}) {
  const uiText = useInterfaceText()

  const { connected, call } = useRuntime()
  const { colors, styles } = useTheme()
  const { page, error, busy, refresh, loadBefore } = useNativeThreadHistory(
    call,
    connected,
    taskId,
    agent,
  )
  return (
    <View style={{ flex: 1 }} accessibilityLabel={uiText('Native agent thread')}>
      <ScreenHeader
        title={agent.name}
        leading={<Action secondary label={uiText('Back to agents')} onPress={onClose} />}
        buttons={[
          {
            label: uiText('Refresh thread'),
            icon: 'refresh',
            disabled: !connected || busy,
            onPress: refresh,
          },
        ]}
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        accessibilityLabel={uiText('Native agent thread')}
      >
        {!connected && (
          <Text style={styles.muted}>
            <InterfaceText>{'Reconnect to load this native thread.'}</InterfaceText>
          </Text>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {error}
          </Text>
        )}
        {!!page?.notice && <Text style={styles.muted}>{page.notice}</Text>}
        {!!page?.before && (
          <Action
            secondary
            label={uiText('Load older messages')}
            disabled={!connected || busy}
            onPress={() => loadBefore(page.before)}
          />
        )}
        {busy && (
          <Text style={styles.muted}>
            <InterfaceText>{'Loading thread…'}</InterfaceText>
          </Text>
        )}
        {page?.entries.map((entry) => (
          <View
            key={entry.id}
            style={
              entry.role === 'user'
                ? {
                    alignSelf: 'flex-end',
                    maxWidth: '88%',
                    paddingHorizontal: 13,
                    paddingVertical: 9,
                    borderRadius: 18,
                    backgroundColor: colors.elevated,
                  }
                : { gap: 5 }
            }
          >
            {entry.image && (
              <Image
                source={{ uri: `data:${entry.image.mime};base64,${entry.image.data}` }}
                accessibilityLabel={uiText('Generated image')}
                style={{ width: '100%', height: 280 }}
                resizeMode="contain"
              />
            )}
            {entry.role === 'tool' || entry.role === 'reasoning' ? (
              <>
                <Text style={styles.muted}>
                  {entry.label ||
                    (entry.role === 'reasoning' ? uiText('Reasoning') : uiText('Tool'))}
                </Text>
                <Text
                  selectable
                  style={{ color: colors.muted, fontFamily: 'monospace', fontSize: 13 }}
                >
                  {entry.text}
                </Text>
              </>
            ) : (
              <Markdown text={entry.text} taskId={taskId} />
            )}
          </View>
        ))}
        {page && !page.entries.length && (
          <Text style={styles.muted}>
            <InterfaceText>{'No conversation messages are available.'}</InterfaceText>
          </Text>
        )}
      </ScrollView>
      <Text
        style={[styles.muted, { padding: 16, borderTopWidth: 0.5, borderTopColor: colors.border }]}
      >
        <InterfaceText
          values={{
            value0: parentTitle && `${parentTitle} · `,
            value1: subagentMetadata(agent) || agent.provider,
            value2: agent.status,
          }}
        >
          {'{value0}{value1} · {value2} · Read only'}
        </InterfaceText>
      </Text>
    </View>
  )
}
