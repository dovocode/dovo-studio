import { Linking, View } from 'react-native'
import { useState } from 'react'
import { type Task, issueLabel } from '@dovo/protocol'
import { useNavigation } from '../shell/navigation'
import { Action } from '../ui/action'
import { IconButton } from '../ui/icon-button'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'

export function TaskSource({ task, onNavigate }: { task: Task; onNavigate?: () => void }) {
  const { openWork } = useNavigation()
  const [error, setError] = useState('')
  const source = task.workItem
  if (!source) return null
  return (
    <View style={{ gap: 4 }}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Action
          secondary
          label={
            source.kind === 'issue'
              ? `Open issue ${issueLabel(source.id)}`
              : `Open pipeline #${source.id}`
          }
          onPress={() => {
            onNavigate?.()
            openWork({
              repositoryId: task.repositoryId,
              ...(source.kind === 'issue' && source.jiraSourceId
                ? { jiraSourceId: source.jiraSourceId }
                : {}),
              kind: source.kind,
              id: source.id,
              url: source.url,
            })
          }}
        />
        <IconButton
          icon="web"
          label="Open source on server"
          onPress={() => void Linking.openURL(source.url).catch((cause) => setError(String(cause)))}
        />
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
