import { useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import {
  artifactDeleteResponseSchema,
  artifactWriteResponseSchema,
  resolveTaskAgent,
  projectDisplayName,
  type ArtifactMetadata,
  type RuntimeProfile,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useNavigation } from '../../shell/navigation'
import { SafeModal } from '../layout/safe-modal'
import { Action } from '../controls/action'
import { Choice } from '../controls/choice'
import { SearchField } from '../controls/field'
import { Text } from './text'
import { useTheme } from '../theme'
import { Sheet, type SheetHandle } from '../layout/sheet'
import { IconButton } from '../controls/icon-button'

export function ArtifactLibraryActions({
  profile,
  artifact,
  onDeleted,
  onOpenSource,
}: {
  profile: RuntimeProfile
  artifact: ArtifactMetadata
  onDeleted: () => void
  onOpenSource?: () => void
}) {
  const { overviews, readRuntime } = useRuntime()
  const { navigate } = useNavigation()
  const { styles } = useTheme()
  const runtime = overviews.find((entry) => entry.profile.id === profile.id)
  const [action, setAction] = useState<'add' | 'delete'>()
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [added, setAdded] = useState('')
  const [menu, setMenu] = useState(false)
  const sheet = useRef<SheetHandle>(null)
  const tasks = (runtime?.snapshot?.workspace.tasks ?? []).filter(
    (task) =>
      task.id !== artifact.taskId &&
      !task.archived &&
      !task.archivedAt &&
      resolveTaskAgent(task, runtime?.snapshot?.workspace.agents ?? [])?.permission !==
        'read-only' &&
      task.title.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      if (action === 'delete') {
        await readRuntime(
          profile,
          '/api/artifacts/delete',
          { taskId: artifact.taskId, id: artifact.id, expectedRevision: artifact.revision },
          artifactDeleteResponseSchema,
        )
        onDeleted()
      } else {
        await readRuntime(
          profile,
          '/api/artifacts/attach',
          {
            taskId: artifact.taskId,
            id: artifact.id,
            revision: artifact.revision,
            targetTaskId: target,
          },
          artifactWriteResponseSchema,
        )
        setAdded(target)
      }
      setAction(undefined)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          paddingHorizontal: 12,
          paddingBottom: 4,
        }}
      >
        {onOpenSource && <Action secondary label="Open source thread" onPress={onOpenSource} />}
        <IconButton
          label={`Artifact actions ${artifact.title}`}
          icon="more"
          onPress={() => setMenu(true)}
        />
      </View>
      {menu && (
        <Sheet ref={sheet} title={artifact.title} onClose={() => setMenu(false)}>
          <Action
            secondary
            label="Add to thread"
            disabled={!runtime?.connected}
            onPress={() => {
              sheet.current?.dismiss(() => {
                setError('')
                setAdded('')
                setQuery('')
                setTarget('')
                setAction('add')
              })
            }}
          />
          <Action
            secondary
            label="Delete artifact"
            disabled={!runtime?.connected}
            onPress={() => {
              sheet.current?.dismiss(() => {
                setError('')
                setAction('delete')
              })
            }}
          />
        </Sheet>
      )}
      {!!added && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>
          <Text style={styles.muted}>Added to thread.</Text>
          <Action
            secondary
            label="Open thread"
            onPress={() => navigate('tasks', added, profile.id)}
          />
        </View>
      )}
      <SafeModal
        visible={!!action}
        animationType="slide"
        onRequestClose={() => {
          if (!busy) setAction(undefined)
        }}
      >
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <Text style={[styles.text, { fontSize: 20, fontWeight: '600' }]}>
            {action === 'delete' ? 'Delete artifact?' : 'Add artifact to a thread'}
          </Text>
          <Text style={styles.muted}>
            {action === 'delete'
              ? `“${artifact.title}” and all its saved versions will be permanently deleted. Copies in other threads are kept.`
              : `Copy “${artifact.title}” into a thread on this computer. The original stays here.`}
          </Text>
          {action === 'add' && (
            <>
              <SearchField
                label="Search destination threads"
                placeholder="Search threads…"
                value={query}
                onChangeText={setQuery}
              />
              <Choice
                label="Destination thread"
                value={target}
                items={[
                  { id: '', name: 'Choose a thread…' },
                  ...tasks.map((task) => ({
                    id: task.id,
                    name: `${task.title} · ${projectDisplayName(runtime?.snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId))}`,
                  })),
                ]}
                onChange={setTarget}
              />
              {!!query.trim() && !tasks.length && (
                <Action secondary label="Clear thread search" onPress={() => setQuery('')} />
              )}
              {!tasks.length && (
                <Text style={styles.muted}>
                  {query.trim()
                    ? 'No threads match this search. Clear the search to see available threads.'
                    : 'No writable threads. Create or reopen a thread on this computer first.'}
                </Text>
              )}
            </>
          )}
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Action
            label={busy ? 'Saving…' : action === 'delete' ? 'Delete artifact' : 'Add to thread'}
            disabled={
              busy ||
              !runtime?.connected ||
              (action === 'add' && !tasks.some((task) => task.id === target))
            }
            onPress={() => void run()}
          />
          <Action secondary label="Cancel" disabled={busy} onPress={() => setAction(undefined)} />
        </ScrollView>
      </SafeModal>
    </>
  )
}
