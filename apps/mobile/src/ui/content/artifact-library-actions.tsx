import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
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
  const uiText = useInterfaceText()

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
        {onOpenSource && (
          <Action secondary label={uiText('Open source thread')} onPress={onOpenSource} />
        )}
        <IconButton
          label={uiText('Artifact actions {value0}', { value0: artifact.title })}
          icon="more"
          onPress={() => setMenu(true)}
        />
      </View>
      {menu && (
        <Sheet ref={sheet} title={artifact.title} onClose={() => setMenu(false)}>
          <Action
            secondary
            label={uiText('Add to thread')}
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
            destructive
            secondary
            label={uiText('Delete artifact')}
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
          <Text style={styles.muted}>
            <InterfaceText>{'Added to thread.'}</InterfaceText>
          </Text>
          <Action
            secondary
            label={uiText('Open thread')}
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
            {action === 'delete' ? uiText('Delete artifact?') : uiText('Add artifact to a thread')}
          </Text>
          <Text style={styles.muted}>
            {action === 'delete'
              ? uiText(
                  '“{value0}” and all its saved versions will be permanently deleted. Copies in other threads are kept.',
                  { value0: artifact.title },
                )
              : uiText('Copy “{value0}” into a thread on this computer. The original stays here.', {
                  value0: artifact.title,
                })}
          </Text>
          {action === 'add' && (
            <>
              <SearchField
                label={uiText('Search destination threads')}
                placeholder={uiText('Search threads…')}
                value={query}
                onChangeText={setQuery}
              />
              <Choice
                label={uiText('Destination thread')}
                value={target}
                items={[
                  { id: '', name: uiText('Choose a thread…') },
                  ...tasks.map((task) => ({
                    id: task.id,
                    name: `${task.title} · ${projectDisplayName(runtime?.snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId))}`,
                  })),
                ]}
                onChange={setTarget}
              />
              {!!query.trim() && !tasks.length && (
                <Action
                  secondary
                  label={uiText('Clear thread search')}
                  onPress={() => setQuery('')}
                />
              )}
              {!tasks.length && (
                <Text style={styles.muted}>
                  {query.trim()
                    ? uiText(
                        'No threads match this search. Clear the search to see available threads.',
                      )
                    : uiText(
                        'No writable threads. Create or reopen a thread on this computer first.',
                      )}
                </Text>
              )}
            </>
          )}
          {!!error && <Text style={styles.error}>{error}</Text>}
          <Action
            destructive={busy ? false : action === 'delete' ? true : false}
            label={
              busy
                ? uiText('Saving…')
                : action === 'delete'
                  ? uiText('Delete artifact')
                  : uiText('Add to thread')
            }
            disabled={
              busy ||
              !runtime?.connected ||
              (action === 'add' && !tasks.some((task) => task.id === target))
            }
            onPress={() => void run()}
          />
          <Action
            secondary
            label={uiText('Cancel')}
            disabled={busy}
            onPress={() => setAction(undefined)}
          />
        </ScrollView>
      </SafeModal>
    </>
  )
}
