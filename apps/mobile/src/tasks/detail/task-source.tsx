import { openAppLink } from '../../ui/content/open-link'
import { nativeEffect } from '../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { View } from 'react-native'
import { type Task, issueLabel } from '@dovo/protocol'
import { router } from 'expo-router'
import { issueHref, jiraIssueHref, pipelineHref } from '../../shell/source-route'
import { useRuntime } from '../../runtime/connection/provider'
import { useSheetNavigation } from '../../ui/layout/sheet'
import { useNavigation } from '../../shell/navigation'
import { Action } from '../../ui/controls/action'
import { IconButton } from '../../ui/controls/icon-button'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
export function TaskSource({ task, onNavigate }: { task: Task; onNavigate?: () => void }) {
  const { styles } = useTheme()

  const { openWork } = useNavigation()
  const { activeId } = useRuntime()
  const navigateAfterSheet = useSheetNavigation()
  const [error, setError] = useApplicationState('')
  const source = task.workItem
  if (!source) return null
  return (
    <View
      style={{
        gap: 4,
      }}
    >
      <View
        style={[
          styles.row,
          {
            justifyContent: 'space-between',
          },
        ]}
      >
        <Action
          secondary
          label={
            source.kind === 'issue'
              ? `Open issue ${issueLabel(source.id)}`
              : `Open pipeline #${source.id}`
          }
          onPress={() => {
            navigateAfterSheet(() => {
              onNavigate?.()
              if (activeId) {
                const href =
                  source.kind === 'pipeline'
                    ? pipelineHref(activeId, task.repositoryId, source.id, source.url)
                    : source.jiraSourceId
                      ? jiraIssueHref(activeId, source.jiraSourceId, source.id, source.url)
                      : issueHref(activeId, task.repositoryId, source.id, source.url)
                router.push(href)
              } else
                openWork({
                  repositoryId: task.repositoryId,
                  kind: source.kind,
                  id: source.id,
                  url: source.url,
                })
            })
          }}
        />
        <IconButton
          icon="web"
          label="Open source on server"
          onPress={() =>
            void runClientEffect(
              nativeEffect(() =>
                navigateAfterSheet(() => {
                  void openAppLink(source.url, true).catch((cause) => setError(String(cause)))
                }),
              ).pipe(Effect.catch((cause) => nativeEffect(() => setError(String(cause))))),
            )
          }
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
