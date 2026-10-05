import { Pressable, View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import {
  fixFindingsPrompt,
  responses,
  reviewFindings,
  type ReviewFinding,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { useAction } from '../../../ui/controls/use-action'
import { Action } from '../../../ui/controls/action'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'

/** The agent's own review as a list; fix one finding or all of them. */
export function ReviewFindings({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { colors, styles } = useTheme()

  const { connected, callEffect } = useRuntime()
  const { act, busy, error } = useAction()
  const findings = reviewFindings(task)
  if (!findings.length) return null
  const fix = (items: readonly ReviewFinding[]) =>
    act(() =>
      callEffect(
        '/api/tasks/message',
        { id: task.id, messageId: randomUUID(), text: fixFindingsPrompt(items) },
        responses.ok,
      ),
    )
  return (
    <View style={[styles.card, { marginHorizontal: 16, marginBottom: 6, gap: 6 }]}>
      <Text style={[styles.text, { fontWeight: '600' }]}>
        {findings.length} review {findings.length === 1 ? 'finding' : 'findings'}
      </Text>
      {findings.slice(0, 8).map((finding, index) => (
        <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${finding.path} line ${finding.line}: ${finding.text}. Opens changes.`}
            onPress={onOpen}
            style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.55 : 1 })}
          >
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {finding.path}:{finding.line}
            </Text>
            <Text numberOfLines={3} style={styles.muted}>
              {finding.text}
            </Text>
          </Pressable>
          <Action
            secondary
            label="Fix"
            disabled={!connected || busy}
            onPress={() => fix([finding])}
          />
        </View>
      ))}
      {findings.length > 8 && <Text style={styles.muted}>And {findings.length - 8} more.</Text>}
      <Action label="Fix all" disabled={!connected || busy} onPress={() => fix(findings)} />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
