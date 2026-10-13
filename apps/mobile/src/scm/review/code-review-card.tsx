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
  const { report, error } = useTaskReview(task.id, task.status, !task.example),
    { styles } = useTheme()
  const latest = report?.reviews[0]
  if (!latest) return null
  const findings = latest.findings.filter(
    (finding) => finding.status === 'open' || finding.status === 'addressed',
  )
  return (
    <View style={[styles.card, { marginHorizontal: 16, marginBottom: 8, gap: 8 }]}>
      <Text style={[styles.text, { fontWeight: '600' }]}>Independent review · {latest.status}</Text>
      <Text style={styles.muted}>
        {latest.reviewer} · {findings.length} open findings
        {report?.current ? '' : ' · changes since review'}
        {report?.approved ? ' · approved for push' : ''}
      </Text>
      <Action secondary label="Open review" onPress={() => onOpen()} />
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
