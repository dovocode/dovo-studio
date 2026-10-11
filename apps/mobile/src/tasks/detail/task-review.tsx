import { changedFileFingerprint, reviewFileState, orderReviewFiles } from '@dovo/protocol'
import { useFileReview } from '../../scm/review/use-file-review'
import { MobileOrganizeReview } from '../../scm/review/organize-review'
import { MobileFileReview } from '../../scm/review/file-review'
import { useConversationSelector } from '../conversation/state/provider'
import { SavedFilePreview } from '../files/saved-file-preview'
import { checkpointFiles, filePreviewLabel } from '@dovo/protocol'
import { fileStats } from '../files/stats'
import { nativeEffect, mobileWorkflow } from '../../runtime/state/native-effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { Choice } from '../../ui/controls/choice'
import { useMemo, useEffect, useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { Text } from '../../ui/content/text'
import { createTwoFilesPatch, FILE_HEADERS_ONLY } from 'diff'
import { responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { Field } from '../../ui/controls/field'
import { useTheme } from '../../ui/theme'
import { useAction } from '../../ui/controls/use-action'
import { DiffView } from '../preview/diff-view'
import { PullStatus } from './pull-status'
import { CommitSection } from './commit-section'
export type FileEditDraft = { path: string; contents: string; expected: string }
export function TaskReview({
  initialCheckpoint = '',
  initialPath = '',
  edit,
  onEditChange: setEdit,
}: {
  initialCheckpoint?: string
  initialPath?: string
  edit: FileEditDraft | null
  onEditChange: (draft: FileEditDraft | null) => void
}) {
  const { styles } = useTheme()

  const task = useConversationSelector((value) => value.task)
  const { call, connected, callEffect, snapshot } = useRuntime(),
    { busy, error, act } = useAction()
  const [checkpoint, setCheckpoint] = useApplicationState(initialCheckpoint)
  const selectedTurn = task.turns?.find((turn) => turn.id === checkpoint)?.checkpoint
  const [checkoutId, setCheckoutId] = useState('')
  const linkedHistory = selectedTurn?.linked?.find((item) => item.checkoutId === checkoutId)
  const history = checkoutId ? linkedHistory : selectedTurn
  const [linkedFiles, setLinkedFiles] = useState<{
    key: string
    files: Task['files']
    error: string
  } | null>(null)
  const loadKey = `${task.id}:${checkoutId}`
  useEffect(() => {
    if (!checkoutId || checkpoint) return
    let active = true
    void call('/api/tasks/checkouts/changes', { id: task.id, checkoutId }, responses.files).then(
      (result) => {
        if (active) setLinkedFiles({ key: loadKey, files: result.files, error: '' })
      },
      (error: unknown) => {
        if (active)
          setLinkedFiles({
            key: loadKey,
            files: [],
            error: error instanceof Error ? error.message : String(error),
          })
      },
    )
    return () => {
      active = false
    }
  }, [call, task.id, checkoutId, checkpoint, loadKey])
  const sourceFiles = useMemo(
    () =>
      checkpoint
        ? history
          ? checkpointFiles(history)
          : []
        : checkoutId
          ? linkedFiles?.key === loadKey
            ? linkedFiles.files
            : []
          : task.files,
    [checkpoint, history, task.files, checkoutId, linkedFiles, loadKey],
  )
  const fingerprints = useMemo(
    () => new Map(sourceFiles.map((file) => [file.path, changedFileFingerprint(file)])),
    [sourceFiles],
  )
  const review = useFileReview(
    {
      kind: 'task',
      taskId: task.id,
      source: checkpoint ? 'turn' : 'working',
      turnId: checkpoint || undefined,
      checkoutId: checkoutId || undefined,
    },
    JSON.stringify([...fingerprints]),
  )
  const [related, setRelated] = useState(true),
    [toolsOpen, setToolsOpen] = useState(false)
  const files = useMemo(
    () =>
      orderReviewFiles(
        sourceFiles.map((file) => ({
          ...file,
          viewed:
            !checkpoint && !checkoutId
              ? file.viewed
              : (reviewFileState(review.progress, file.path, fingerprints.get(file.path) ?? '')
                  ?.viewed ?? false),
        })),
        review.progress?.groups ?? [],
        related,
      ),
    [sourceFiles, fingerprints, review.progress, related, checkpoint, checkoutId],
  )
  const stats = useMemo(
    () => new Map(sourceFiles.map((file) => [file.path, fileStats(file)])),
    [sourceFiles],
  )
  const [path, setPath] = useApplicationState(edit?.path ?? initialPath)
  const file = files.find((file) => file.path === path) ?? files[0]
  const patch = useMemo(
    () =>
      file && !file.preview
        ? createTwoFilesPatch(file.path, file.path, file.before, file.after, undefined, undefined, {
            headerOptions: FILE_HEADERS_ONLY,
          })
        : '',
    [file?.path, file?.preview, file?.before, file?.after],
  )
  const refresh = () =>
    call(
      checkoutId ? '/api/tasks/checkouts/changes' : '/api/scm/changes',
      checkoutId
        ? { id: task.id, checkoutId }
        : { repositoryId: task.repositoryId, taskId: task.id },
      responses.files,
    )
  return (
    <View style={styles.screen}>
      <PullStatus task={task} />
      <View
        style={[
          styles.content,
          {
            paddingVertical: 8,
          },
        ]}
      >
        {!!(checkpoint ? selectedTurn?.linked?.length : task.linkedCheckouts?.length) && (
          <Choice
            label="Project checkout"
            value={checkoutId}
            disabled={!!edit}
            items={[
              { id: '', name: 'Primary checkout' },
              ...((checkpoint
                ? selectedTurn?.linked?.map((item) => ({
                    id: item.checkoutId,
                    name: `${item.repositoryName ?? item.repositoryId} · ${item.branch ?? 'Linked checkout'}`,
                  }))
                : task.linkedCheckouts?.map((item) => ({
                    id: item.id,
                    name: `${snapshot?.workspace.repositories.find((repo) => repo.id === item.repositoryId)?.name ?? item.repositoryId} · ${item.branch ?? item.execution}`,
                  }))) ?? []),
            ]}
            onChange={(id) => {
              setCheckoutId(id)
              setPath('')
            }}
          />
        )}
        {!!checkoutId && !checkpoint && linkedFiles?.key === loadKey && !!linkedFiles.error && (
          <Text style={styles.error}>{linkedFiles.error}</Text>
        )}
        <Choice
          label="Change history"
          value={checkpoint}
          disabled={!!edit}
          items={[
            {
              id: '',
              name: 'Current changes',
            },
            ...(task.turns ?? [])
              .filter((turn) => turn.checkpoint)
              .map((turn, index) => ({
                id: turn.id,
                name: `Turn ${index + 1} · ${turn.status} · ${turn.checkpoint ? checkpointFiles(turn.checkpoint).length : 0} files`,
              })),
          ]}
          onChange={(value) => {
            setCheckpoint(value)
            setCheckoutId('')
            setPath('')
          }}
        />
        {!!history?.error && <Text style={styles.error}>{history.error}</Text>}
        {!!checkpoint && (
          <Text style={styles.muted}>
            Snapshot diff for this turn. Select Current changes to edit files.
          </Text>
        )}
        {toolsOpen && !checkoutId && !checkpoint && <CommitSection task={task} />}
        <View style={styles.row}>
          <Action
            secondary
            label="Refresh changes"
            disabled={!connected || busy || task.example || !!edit || !!checkpoint}
            onPress={() =>
              act(async () => {
                const result = await refresh()
                if (checkoutId) setLinkedFiles({ key: loadKey, files: result.files, error: '' })
                review.reload()
              })
            }
          />
          <Action
            secondary
            label={toolsOpen ? 'Fewer actions' : 'More actions'}
            disabled={!!edit}
            onPress={() => setToolsOpen((value) => !value)}
          />
          {edit ? (
            <Action label="Cancel edit" secondary disabled={busy} onPress={() => setEdit(null)} />
          ) : file && toolsOpen ? (
            <Action
              label="Edit file"
              secondary
              disabled={busy || !!checkpoint || !!checkoutId || !!file.preview}
              onPress={() => {
                setPath(file.path)
                setEdit({
                  path: file.path,
                  contents: file.after,
                  expected: file.diskContents ?? file.after,
                })
              }}
            />
          ) : null}
          {toolsOpen && file && !edit && (!checkpoint || !history?.undone) && (
            <Action
              secondary
              label={checkpoint ? 'Revert this file' : 'Discard file changes'}
              disabled={!connected || busy || task.example || task.status === 'running'}
              onPress={() =>
                Alert.alert(
                  checkpoint ? 'Revert this file?' : 'Discard changes to this file?',
                  checkpoint
                    ? `${file.path} goes back to how it was before this turn. The current file is saved first.`
                    : `${file.path} goes back to the last commit. The current file is saved first, so this can be recovered.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: checkpoint ? 'Revert' : 'Discard',
                      style: 'destructive',
                      onPress: () =>
                        act(() =>
                          callEffect(
                            '/api/tasks/file/restore',
                            {
                              id: task.id,
                              path: file.path,
                              ...(checkpoint ? { turnId: checkpoint } : {}),
                              checkoutId: checkoutId || undefined,
                            },
                            responses.ok,
                          ),
                        ),
                    },
                  ],
                )
              }
            />
          )}
        </View>
      </View>
      {!!files.length && (
        <View
          style={{
            paddingHorizontal: 16,
            paddingBottom: 8,
          }}
        >
          <MobileOrganizeReview
            review={review}
            disabled={!!edit || !!task.example}
            onOrganized={() => setRelated(true)}
          />
          <MobileFileReview
            files={files.map((file) => {
              const amounts = stats.get(file.path)
              return {
                path: file.path,
                viewed: file.viewed,
                label: file.preview
                  ? filePreviewLabel(file)
                  : `+${amounts?.additions ?? 0} −${amounts?.deletions ?? 0}`,
              }
            })}
            groups={review.progress?.groups ?? []}
            related={related}
            onRelatedChange={setRelated}
            selected={file?.path ?? ''}
            onSelect={setPath}
            onViewed={(viewed) => {
              if (file) review.setViewed(file.path, fingerprints.get(file.path) ?? '', viewed)
            }}
            disabled={
              !review.ready ||
              !!edit ||
              !!task.example ||
              !file ||
              !reviewFileState(review.progress, file.path, fingerprints.get(file.path) ?? '')
            }
            busy={review.busy}
            navigationDisabled={!!edit}
            error={review.error}
            onRetry={review.reload}
          />
        </View>
      )}
      {!file && !edit ? (
        <Text style={[styles.muted, styles.content]}>No changed files.</Text>
      ) : edit ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Field
            label={edit.path}
            value={edit.contents}
            editable={!busy}
            onChangeText={(contents) =>
              setEdit({
                ...edit,
                contents,
              })
            }
            multiline
            autoCorrect={false}
            style={[
              styles.input,
              {
                minHeight: 300,
                fontFamily: 'monospace',
                textAlignVertical: 'top',
              },
            ]}
          />
          <Action
            label="Apply to disk"
            disabled={busy || !connected || task.example}
            onPress={() =>
              act(() =>
                mobileWorkflow(function* () {
                  yield* callEffect(
                    '/api/scm/apply',
                    {
                      repositoryId: task.repositoryId,
                      taskId: task.id,
                      path: edit.path,
                      expected: edit.expected,
                      contents: edit.contents,
                    },
                    responses.ok,
                  )
                  setEdit(null)
                  yield* nativeEffect(() => refresh())
                }),
              )
            }
          />
          <Text style={styles.muted}>
            Applies on the connected computer only if the file still matches the loaded baseline.
          </Text>
        </ScrollView>
      ) : file?.preview ? (
        <SavedFilePreview
          key={`${checkpoint}:${checkoutId}:${file.path}`}
          file={file}
          taskId={task.id}
          turnId={checkpoint || undefined}
          working={!checkpoint}
          checkoutId={checkoutId || undefined}
        />
      ) : (
        <DiffView key={`${checkpoint}:${checkoutId}:${file?.path}`} patch={patch} />
      )}
      {!!error && (
        <Text
          style={[
            styles.error,
            {
              padding: 16,
            },
          ]}
        >
          {error}
        </Text>
      )}
    </View>
  )
}
