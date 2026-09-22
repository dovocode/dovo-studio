import { useState } from 'react'
import { View } from 'react-native'
import type { Repository } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Choice } from '../ui/choice'
import { RepositoryCard } from './repository-card'
export function RepositoryCheckouts({ repository }: { repository: Repository }) {
  const { snapshot } = useRuntime()
  const [taskId, setTaskId] = useState('')
  return (
    <View style={{ gap: 8 }}>
      <Choice
        label={`${repository.name} working directory`}
        value={taskId}
        onChange={setTaskId}
        items={[
          { id: '', name: 'Project checkout' },
          ...(snapshot?.workspace.tasks ?? [])
            .filter((t) => t.repositoryId === repository.id && t.execution === 'worktree')
            .map((t) => ({ id: t.id, name: `${t.title} · worktree` })),
        ]}
      />
      <RepositoryCard key={taskId} repository={repository} taskId={taskId || undefined} />
    </View>
  )
}
