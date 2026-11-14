import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { View } from 'react-native'
import type { Task, CodeFinding } from '@dovo/protocol'
import { useTaskReview } from './use-task-review'
import { useTheme } from '../../ui/theme'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
export function CodeReviewCard({
  task,
  onOpen,
}: {
  task: Task
  onOpen: (finding?: CodeFinding) => void
}) {
  const uiText = useInterfaceText()

  const { report, error } = useTaskReview(task.id, task.status, !task.example),
    { styles } = useTheme()
  const latest = report?.reviews[0]
  if (!latest) return null
  const findings = latest.findings.filter(
    (finding) => finding.status === 'open' || finding.status === 'addressed',
  )
  return (
    <View style={[styles.card, { marginHorizontal: 16, marginBottom: 8, gap: 8 }]}>
      <Text style={[styles.text, { fontWeight: '600' }]}>
        <InterfaceText values={{ value0: latest.status }}>
          {'Independent review · {value0}'}
        </InterfaceText>
      </Text>
      <Text style={styles.muted}>
        <InterfaceText
          values={{
            value0: latest.reviewer,
            value1: findings.length,
            value2: report?.current ? '' : uiText(' · changes since review'),
            value3: report?.approved ? uiText(' · approved') : '',
          }}
        >
          {'{value0} · {value1} open findings{value2}{value3}'}
        </InterfaceText>
      </Text>
      <Action secondary label={uiText('Open review')} onPress={() => onOpen()} />
      {findings.slice(0, 3).map((finding) => (
        <Action
          key={finding.id}
          secondary
          label={`${finding.severity.toUpperCase()} · ${finding.path}:${finding.line} — ${finding.title}`}
          onPress={() => onOpen(finding)}
        />
      ))}
      {!!(latest.error || error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {latest.error || error}
        </Text>
      )}
    </View>
  )
}
