import { TaskDefaultSettings } from '../../runtime/preferences/task-default-settings'
import { useApplicationState } from '../../runtime/state/application-state'
import { View } from 'react-native'
import type { Repository } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Choice } from '../../ui/controls/choice'
import { RepositoryCard } from './repository-card'
export function RepositoryCheckouts({ repository }: { repository: Repository }) {
  const { snapshot } = useRuntime()
  const [taskId, setTaskId] = useApplicationState('')
  return (
    <View
      style={{
        gap: 8,
      }}
    >
      {!repository.kind && (
        <Choice
          label={`${repository.name} working directory`}
          value={taskId}
          onChange={setTaskId}
          items={[
            {
              id: '',
              name: 'Project checkout',
            },
            ...(snapshot?.workspace.tasks ?? [])
              .filter((t) => t.repositoryId === repository.id && t.execution === 'worktree')
              .map((t) => ({
                id: t.id,
                name: `${t.title} · worktree`,
              })),
          ]}
        />
      )}
      {repository.kind !== 'scratch' && <TaskDefaultSettings repository={repository} />}
      {!repository.kind && (
        <RepositoryCard key={taskId} repository={repository} taskId={taskId || undefined} />
      )}
    </View>
  )
}
