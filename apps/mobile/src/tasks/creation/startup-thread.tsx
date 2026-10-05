import { useState } from 'react'
import { View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { resolveTaskDefaults, taskMachineDraft, type Task } from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../../runtime/connection/provider'
import { useNavigation } from '../../shell/navigation'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { styles } from '../../ui/theme'
import { Composer } from '../composer/composer'
import { ConversationProvider } from '../conversation/state/provider'
import { saveRuntimeDraft } from '../draft/use-draft'
import { FolderPicker } from './folder-picker'
import { TemporaryTaskRuntime } from './temporary-task-runtime'

export function StartupThread({
  onCommit,
  onBrowse,
}: {
  onCommit: (runtimeId: string, taskId: string) => void
  onBrowse: () => void
}) {
  const runtime = useRuntime()
  const { focused } = useNavigation()
  const [selection, setSelection] = useState<{ runtimeId: string; task: Task } | null>(null)
  const selected =
    runtime.overviews.find((entry) => entry.connected && entry.profile.id === runtime.activeId) ??
    runtime.overviews.find((entry) => entry.connected)
  const runtimeId = selection?.runtimeId ?? selected?.profile.id ?? ''
  const entry = runtime.overviews.find((item) => item.profile.id === runtimeId)
  const repository = entry?.snapshot?.workspace.repositories.find((item) => item.kind === 'scratch')
  const [id] = useState(randomUUID)
  const task: Task | null =
    selection?.task ??
    (repository
      ? {
          ...resolveTaskDefaults(entry?.snapshot?.defaults, repository),
          id,
          title: 'New thread',
          repositoryId: repository.id,
          agentId: '',
          status: 'draft',
          createdAt: new Date().toISOString(),
          messages: [],
          files: [],
          draft: '',
          example: false,
        }
      : null)
  if (!entry?.snapshot)
    return (
      <View style={styles.content}>
        <Text style={styles.title}>Connect a computer</Text>
        <Text style={styles.muted}>A computer needs to be online to start a thread.</Text>
        <Action label="Browse tasks" secondary onPress={onBrowse} />
      </View>
    )
  return (
    <RuntimeScope runtimeId={runtimeId}>
      {task ? (
        <TemporaryTaskRuntime
          key={`${runtimeId}:${task.id}`}
          task={task}
          onCommit={(created) => onCommit(runtimeId, created.id)}
        >
          {(draft) => (
            <ConversationProvider
              task={draft}
              visible={focused}
              temporary
              openCheckpoint={() => {}}
              openTerminal={() => {}}
            >
              <View style={{ flex: 1 }}>
                <View
                  style={{
                    flex: 1,
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 8,
                    padding: 24,
                  }}
                >
                  <Text style={styles.title}>What would you like to work on?</Text>
                  <Text style={styles.muted}>Describe a change or ask a question.</Text>
                  <Action label="Browse tasks" secondary onPress={onBrowse} />
                </View>
                <Composer
                  task={draft}
                  onSelectRemote={async (targetId, target, text) => {
                    const destination = runtime.overviews.find(
                      (item) => item.profile.id === targetId,
                    )
                    if (!destination?.connected) throw new Error('This computer is offline.')
                    const next = taskMachineDraft(
                      { ...draft, draft: text },
                      target,
                      destination.snapshot?.defaults,
                    )
                    await saveRuntimeDraft(targetId, next.id, text)
                    setSelection({ runtimeId: targetId, task: next })
                  }}
                />
              </View>
            </ConversationProvider>
          )}
        </TemporaryTaskRuntime>
      ) : (
        <View style={styles.content}>
          <Text style={styles.title}>Choose a folder</Text>
          <FolderPicker
            repositories={entry.snapshot.workspace.repositories}
            value=""
            disabled={!entry.connected}
            onChange={(_id, target, targetId) => {
              const destination = runtime.overviews.find((item) => item.profile.id === targetId)
              setSelection({
                runtimeId: targetId,
                task: {
                  ...resolveTaskDefaults(destination?.snapshot?.defaults, target),
                  id,
                  title: 'New thread',
                  repositoryId: target.id,
                  agentId: '',
                  status: 'draft',
                  createdAt: new Date().toISOString(),
                  messages: [],
                  files: [],
                  draft: '',
                  example: false,
                },
              })
            }}
          />
          <Action label="Browse tasks" secondary onPress={onBrowse} />
        </View>
      )}
    </RuntimeScope>
  )
}
