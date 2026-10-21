import { responses, type Repository } from '@dovo/protocol'
import { Effect } from 'effect'
import { Alert, View } from 'react-native'
import { mobileWorkflow, nativeEffect } from '../../runtime/state/native-effect'
import { useRuntime } from '../../runtime/connection/provider'
import { useNavigation } from '../../shell/navigation'
import { useTaskListView } from '../../tasks/list/task-list-view'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useAction } from '../../ui/controls/use-action'
import { useTheme } from '../../ui/theme'

export function DeleteProjectAction({ repository }: { repository: Repository }) {
  const { styles } = useTheme()
  const { connected, profile, readRuntimeEffect, refreshRuntimeEffect } = useRuntime()
  const { navigate } = useNavigation()
  const { setView } = useTaskListView()
  const { busy, error, act } = useAction()
  const confirm = () =>
    Alert.alert(
      `Delete “${repository.name}”?`,
      'This removes the project and its task and conversation history from Dovo. Repository and worktree files stay on disk. Active work must finish before you can delete this project.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete project and history',
          style: 'destructive',
          onPress: () => {
            if (!profile) return
            act(() =>
              mobileWorkflow(function* () {
                yield* readRuntimeEffect(
                  profile,
                  '/api/scm/repositories/delete',
                  { repositoryId: repository.id },
                  responses.ok,
                  'POST',
                )
                setView((current) => ({ ...current, project: 'scratch', source: 'all' }))
                yield* nativeEffect(() => navigate('tasks'))
                yield* refreshRuntimeEffect(profile).pipe(
                  Effect.catch((cause) =>
                    nativeEffect(() =>
                      Alert.alert(
                        'Project deleted',
                        `The project was removed from Dovo, but the project list could not refresh: ${cause instanceof Error ? cause.message : String(cause)}`,
                      ),
                    ),
                  ),
                )
              }),
            )
          },
        },
      ],
    )
  return (
    <View style={{ gap: 4 }}>
      <Action label={`Delete ${repository.name}`} disabled={!connected || busy} onPress={confirm} />
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
