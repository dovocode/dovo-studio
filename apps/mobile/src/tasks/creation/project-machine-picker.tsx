import { useApplicationState } from '../../runtime/state/application-state'
import { RuntimeScope, useRuntime } from '../../runtime/connection/provider'
import { ScrollView } from 'react-native'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'
import { NewTask } from './new-task'
import { FolderPicker } from './folder-picker'

export function ProjectMachinePicker({
  onCreated,
  noProject = false,
  onCancel,
}: {
  noProject?: boolean
  onCreated: (runtimeId: string, taskId: string) => void
  onCancel: () => void
}) {
  const { styles } = useTheme()

  const { overviews, activeId } = useRuntime()
  const [machine, setMachine] = useApplicationState<string | null>(null)
  const runtimeId = machine ?? activeId ?? overviews[0]?.profile.id ?? ''
  const entry = overviews.find((item) => item.profile.id === runtimeId)
  const [repositoryId, setRepositoryId] = useApplicationState<string | null>(null)
  if (repositoryId)
    return (
      <RuntimeScope runtimeId={runtimeId}>
        <NewTask
          repositoryId={repositoryId}
          onCancel={() => setRepositoryId(null)}
          onCreated={(id) => onCreated(runtimeId, id)}
        />
      </RuntimeScope>
    )
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>New thread</Text>
      <Text style={styles.muted}>Choose where to work. Nothing runs until your first message.</Text>
      {entry && (
        <RuntimeScope key={runtimeId} runtimeId={runtimeId}>
          <FolderPicker
            chatOnly={noProject}
            repositories={entry.snapshot?.workspace.repositories ?? []}
            value=""
            disabled={!entry.connected}
            onChange={(id, _repository, machineId) => {
              setMachine(machineId)
              setRepositoryId(id)
            }}
          />
        </RuntimeScope>
      )}
      <Action secondary label="Cancel" onPress={onCancel} />
    </ScrollView>
  )
}
