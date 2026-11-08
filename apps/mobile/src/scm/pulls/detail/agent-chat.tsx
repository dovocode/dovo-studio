import { useRef, useState } from 'react'
import { randomUUID } from 'expo-crypto'
import { router } from 'expo-router'
import { Schema } from 'effect'
import {
  buildPullReviewObjective,
  mutableStruct,
  pullLinkedTasks,
  pullTaskResponse,
  type PullDetail,
} from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { taskHref } from '../../../shell/task-route'
import { Action } from '../../../ui/controls/action'
import { Choice } from '../../../ui/controls/choice'
import { Field } from '../../../ui/controls/field'
import { useAction } from '../../../ui/controls/use-action'
import { Text } from '../../../ui/content/text'
import { Sheet, type SheetHandle } from '../../../ui/layout/sheet'
import { useTheme } from '../../../ui/theme'
import { useOperationGuard } from '../../../runtime/state/use-operation-guard'
import {
  prepareRuntimeSideThread,
  finishRuntimeSideThread,
} from '../../../tasks/draft/runtime-drafts'

/** Select the conversation explicitly; a matching branch does not select an account or agent. */
export function PullAgentChat({
  repositoryId,
  detail: initialDetail,
  latestDetail = initialDetail,
  path: initialPath,
  sourceIdentity,
  onClose,
}: {
  repositoryId: string
  detail: PullDetail
  latestDetail?: PullDetail
  path?: string
  sourceIdentity?: string
  onClose: () => void
}) {
  const [detail, setDetail] = useState(initialDetail)
  const [path, setPath] = useState(initialPath)
  const { connected, snapshot, profile, call, legacyDraftRuntimeId } = useRuntime()
  const repository = snapshot?.workspace.repositories.find((item) => item.id === repositoryId)
  const scope = JSON.stringify([
    profile?.id,
    profile?.connection.address,
    snapshot?.runtimeId,
    repositoryId,
    repository?.forge,
    sourceIdentity,
  ])
  const origin = useRef(scope)
  const revisionChanged =
    latestDetail.pull.headSha !== detail.pull.headSha ||
    latestDetail.pull.baseSha !== detail.pull.baseSha
  const current = useOperationGuard(
    JSON.stringify([scope, latestDetail.pull.headSha, latestDetail.pull.baseSha]),
  )
  const sourceChanged = origin.current !== scope
  const { styles } = useTheme()
  const action = useAction()
  const sheet = useRef<SheetHandle>(null)
  const attempt = useRef<{ id: string; key: string } | undefined>(undefined)
  const [parentId, setParentId] = useState('')
  const [question, setQuestion] = useState('')
  const [line, setLine] = useState('')
  const [end, setEnd] = useState('')
  const [side, setSide] = useState<'additions' | 'deletions'>('additions')
  const parents = pullLinkedTasks(snapshot?.workspace.tasks ?? [], detail.pull.url).filter(
    (task) => task.repositoryId === repositoryId && !task.sideThread && !task.archivedAt,
  )
  const open = (id: string) => {
    if (profile && current())
      sheet.current?.dismiss(() => {
        if (current()) router.push(taskHref(profile.id, id))
      })
  }
  const create = () =>
    action.act(async () => {
      if (sourceChanged || !current())
        throw new Error('The PR source changed. Close and reopen this review action.')
      if (revisionChanged)
        throw new Error('Use the latest revision before creating this review draft.')
      const objective = buildPullReviewObjective(detail, {
        question,
        path,
        start: line ? Number(line) : undefined,
        end: end ? Number(end) : undefined,
        side,
      })
      if (parentId) {
        const parent = parents.find((task) => task.id === parentId)
        if (!parent || !profile) throw new Error('Choose an available linked thread.')
        const key = JSON.stringify([parentId, objective])
        if (attempt.current?.key !== key) attempt.current = { id: randomUUID(), key }
        const id = await prepareRuntimeSideThread(
          profile.id,
          parentId,
          attempt.current.id,
          objective,
          parent.draft ?? '',
          legacyDraftRuntimeId,
        )
        if (!current()) return
        const result = await call(
          '/api/tasks/side-thread/create',
          { id: parentId, childId: id, objective },
          mutableStruct({ id: Schema.String }),
        )
        await finishRuntimeSideThread(profile.id, parentId, id)
        open(result.id)
      } else {
        const result = await call(
          '/api/scm/pulls/task',
          {
            repositoryId,
            number: detail.pull.number,
            headSha: detail.pull.headSha,
            expectedDestination: detail.destination ?? detail.pull.destination,
            connectionId: detail.pull.connectionId,
            objective,
            checkoutMode: 'new-branch',
            run: false,
          },
          pullTaskResponse,
        )
        open(result.id)
      }
    })
  return (
    <Sheet ref={sheet} title="Ask agent about this PR" onClose={onClose} busy={action.busy}>
      <Text style={styles.muted}>
        PR #{detail.pull.number} · {detail.pull.headSha.slice(0, 8)}
        {path ? ` · ${path}` : ''}
      </Text>
      <Text style={styles.muted}>
        The PR and selected diff are added to an editable agent draft. Choose the model and send
        when ready.
      </Text>
      {sourceChanged && (
        <Text accessibilityRole="alert" style={styles.error}>
          The PR source changed. Close and reopen this review action.
        </Text>
      )}
      {revisionChanged && !sourceChanged && (
        <>
          <Text accessibilityRole="alert" style={styles.muted}>
            New commits are available. Keep your question and use the latest revision; selected
            lines will be cleared.
          </Text>
          <Action
            secondary
            label="Use latest revision"
            disabled={
              action.busy || !connected || !!latestDetail.stale || !!latestDetail.refreshError
            }
            onPress={() => {
              setDetail(latestDetail)
              if (path && !latestDetail.files.some((file) => file.path === path)) setPath(undefined)
              setLine('')
              setEnd('')
              attempt.current = undefined
            }}
          />
        </>
      )}
      <Choice
        label="Conversation"
        value={parentId}
        items={[
          { id: '', name: 'New review thread', disabled: !repository || !!repository.kind },
          ...parents.map((task) => ({ id: task.id, name: `Side chat of ${task.title}` })),
        ]}
        onChange={setParentId}
        disabled={action.busy}
      />
      <Field
        label="Question or task"
        value={question}
        onChangeText={setQuestion}
        multiline
        maxLength={4000}
        editable={!action.busy}
        placeholder="What would you like the agent to review?"
      />
      {!!path && (
        <>
          <Choice
            label="Diff side"
            value={side}
            items={[
              { id: 'additions', name: 'After' },
              { id: 'deletions', name: 'Before' },
            ]}
            onChange={(value) => {
              if (value === 'additions' || value === 'deletions') setSide(value)
            }}
            disabled={action.busy}
          />
          <Field
            label="Start line (optional)"
            value={line}
            onChangeText={setLine}
            keyboardType="number-pad"
            editable={!action.busy}
          />
          <Field
            label="End line (optional)"
            value={end}
            onChangeText={setEnd}
            keyboardType="number-pad"
            editable={!action.busy}
          />
        </>
      )}
      <Action
        label={parentId ? 'Create agent side chat' : 'Create review thread'}
        disabled={
          !connected ||
          sourceChanged ||
          revisionChanged ||
          !profile ||
          action.busy ||
          !!detail.stale ||
          !!detail.refreshError ||
          (!parentId && (!repository || !!repository.kind))
        }
        onPress={create}
      />
      {!!action.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {action.error}
        </Text>
      )}
    </Sheet>
  )
}
