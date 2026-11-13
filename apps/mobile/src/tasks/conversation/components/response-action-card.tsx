import { useState } from 'react'
import { View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { runClientEffect } from '@dovo/client-runtime'
import {
  RuntimeRequestError,
  decode,
  responseActionSendSchema,
  responseActionText,
  responseFormDefaults,
  threadActionResultSchema,
  type ResponseActionSend,
  type Task,
  type ThreadAction,
} from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import {
  createDetailDrafts,
  detailDraftKey,
  useDetailDraft,
} from '../../../runtime/state/detail-drafts'
import { Action } from '../../../ui/controls/action'
import { Choice } from '../../../ui/controls/choice'
import { Field } from '../../../ui/controls/field'
import { useAction } from '../../../ui/controls/use-action'
import { Text } from '../../../ui/content/text'
import { Sheet, useSheetNavigation } from '../../../ui/layout/sheet'
import { useTheme } from '../../../ui/theme'

type Draft = {
  text: string
  values?: Record<string, string>
  actionId?: string
  attempt?: ResponseActionSend
  stale?: boolean
}
const drafts = createDetailDrafts<Draft>()
type Props = { task: Task; action: ThreadAction; onTerminal?: (id: string) => void }
export function ResponseActionCard(props: Props) {
  const { profile } = useRuntime()
  const key = detailDraftKey(
    profile?.connection ?? null,
    'response-action',
    props.task.id,
    props.action.id,
  )
  return <ResponseActionBody key={key} {...props} draftKey={key} />
}
function ResponseActionBody({
  task,
  action,
  onTerminal,
  draftKey: key,
}: Props & { draftKey: string }) {
  const { snapshot, connected, callEffect } = useRuntime()
  const { styles, colors } = useTheme()
  const { act, busy, error } = useAction()
  const navigate = useSheetNavigation()
  const [editing, setEditing] = useState(false)
  const [receipt, setReceipt] = useState<ThreadAction>()
  const { draft, setField } = useDetailDraft(drafts, key, () => ({
    text: action.prompt,
    values: action.response ? responseFormDefaults(action.response) : {},
  }))
  const current = receipt && receipt.updatedAt >= action.updatedAt ? receipt : action
  const response = current.response
  if (!snapshot?.responseActionsSupported || !response || current.state === 'dismissed') return null
  const operation = response.kind === 'form' ? current.responseReview?.resolved : response
  const prompt = operation?.kind === 'prompt'
  const frozen = !!draft.attempt
  const reviewed = !!current.responseReview && !draft.stale
  const result = current.responseResult
  const review = (actionId = draft.actionId) =>
    act(async () => {
      const dispatch =
        response.kind === 'form' ? { actionId, values: draft.values ?? {} } : undefined
      const result = await runClientEffect(
        callEffect(
          '/api/thread-actions/review',
          {
            sourceTaskId: task.id,
            actionId: action.id,
            ...(dispatch ? { dispatch } : {}),
          },
          threadActionResultSchema,
        ),
      )
      setReceipt(result.action)
      if (!draft.attempt) {
        setField('actionId', actionId)
        setField('stale', false)
        if (
          result.action.responseReview?.resolved.kind === 'prompt' &&
          (draft.actionId !== actionId || draft.stale)
        )
          setField('text', result.action.responseReview.resolved.prompt)
      }
      setEditing(result.action.state === 'prepared')
    })
  const send = () =>
    act(async () => {
      const latest = drafts.read(key) ?? draft
      const attempt =
        latest.attempt ??
        decode(responseActionSendSchema, {
          sourceTaskId: task.id,
          actionId: action.id,
          response: true,
          revision: current.responseReview?.revision ?? '',
          messageId: randomUUID(),
          ...(prompt ? { text: latest.text } : {}),
        })
      if (!drafts.write(key, { ...latest, attempt }))
        throw Error('Save another response action draft before sending.')
      let result
      try {
        result = await runClientEffect(
          callEffect('/api/thread-actions/send', attempt, threadActionResultSchema),
        )
      } catch (cause) {
        if (cause instanceof RuntimeRequestError && cause.mutationRejected)
          drafts.write(key, { ...latest, attempt: undefined, stale: true })
        throw cause
      }
      setReceipt(result.action)
      drafts.remove(key)
      setEditing(false)
    })
  return (
    <View
      style={{ padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, gap: 8 }}
    >
      <Text style={styles.title}>{current.title}</Text>
      <Text style={styles.muted}>
        {response.kind === 'prompt'
          ? 'This thread'
          : response.kind === 'form'
            ? 'Custom form'
            : response.kind === 'command'
              ? 'Command'
              : `MCP · ${response.server} · ${response.tool}`}
      </Text>
      <Text numberOfLines={4}>{responseActionText(response)}</Text>
      {!!error && !editing && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {current.state === 'sent' ? (
        <>
          <Text accessibilityRole="text">
            {result?.status === 'running'
              ? 'Running…'
              : prompt
                ? 'Sent to this thread'
                : (result?.status ?? 'Accepted')}
          </Text>
          {!!result?.output && <Text selectable>{result.output}</Text>}
          {!!result?.terminalId && !!onTerminal && (
            <Action
              label="Open terminal"
              secondary
              onPress={() => {
                const id = result.terminalId
                if (id) navigate(() => onTerminal(id))
              }}
            />
          )}
          {result?.status === 'running' && (
            <Action
              label="Refresh result"
              secondary
              disabled={busy || !connected}
              onPress={() => review()}
            />
          )}
        </>
      ) : (
        <>
          <Action
            label={
              response.kind === 'form' ? 'Open form' : prompt ? 'Review prompt' : 'Review action'
            }
            disabled={busy || !connected}
            onPress={() => (frozen || response.kind === 'form' ? setEditing(true) : review())}
          />
          <Action
            label="Dismiss response action"
            secondary
            disabled={busy || !connected || frozen}
            onPress={() =>
              act(async () => {
                const result = await runClientEffect(
                  callEffect(
                    '/api/thread-actions/dismiss',
                    { sourceTaskId: task.id, actionId: action.id },
                    threadActionResultSchema,
                  ),
                )
                setReceipt(result.action)
                drafts.remove(key)
              })
            }
          />
        </>
      )}
      {editing && current.state === 'prepared' && (
        <Sheet
          title={current.title}
          busy={busy}
          onClose={() => setEditing(false)}
          footer={
            <View style={{ gap: 8 }}>
              {!frozen && (response.kind !== 'form' || !!draft.actionId) && (
                <Action
                  label="Refresh review"
                  secondary
                  disabled={busy || !connected}
                  onPress={() => review()}
                />
              )}
              <Action
                wide
                label={
                  busy ? 'Sending…' : frozen ? 'Retry' : prompt ? 'Send to thread' : 'Run action'
                }
                disabled={
                  busy || !connected || (!frozen && (!reviewed || (prompt && !draft.text.trim())))
                }
                onPress={send}
              />
            </View>
          }
        >
          <View style={{ gap: 16 }}>
            {response.kind === 'form' && (
              <>
                <Text style={styles.muted}>{response.description}</Text>
                {response.fields.map((field) =>
                  field.type === 'choice' ? (
                    <Choice
                      key={field.id}
                      label={field.label}
                      value={draft.values?.[field.id] ?? ''}
                      items={[
                        { id: '', name: 'Choose…' },
                        ...(field.options ?? []).map((option) => ({
                          id: option.value,
                          name: option.label,
                        })),
                      ]}
                      disabled={busy || frozen}
                      onChange={(value) => {
                        setField('values', { ...draft.values, [field.id]: value })
                        setField('stale', true)
                      }}
                    />
                  ) : (
                    <Field
                      key={field.id}
                      label={field.label + (field.required ? ' *' : '')}
                      value={draft.values?.[field.id] ?? ''}
                      multiline={field.type === 'multiline'}
                      maxLength={4000}
                      editable={!busy && !frozen}
                      onChangeText={(value) => {
                        setField('values', { ...draft.values, [field.id]: value })
                        setField('stale', true)
                      }}
                    />
                  ),
                )}
                {response.actions.map((item) => (
                  <Action
                    key={item.id}
                    label={`Review ${item.title}`}
                    secondary
                    disabled={busy || frozen || !connected}
                    onPress={() => review(item.id)}
                  />
                ))}
              </>
            )}
            {operation && (
              <>
                <Text>
                  {prompt ? 'Destination: this thread' : 'Runs on this thread’s computer'}
                </Text>
                {!!current.responseReview?.directory && (
                  <Text selectable style={styles.muted}>
                    Directory: {current.responseReview.directory}
                  </Text>
                )}
                <Text>{current.responseReview?.description}</Text>
                {prompt ? (
                  <Field
                    label="Prompt"
                    multiline
                    value={draft.text}
                    editable={!busy && !frozen}
                    maxLength={20000}
                    onChangeText={(text) => setField('text', text)}
                  />
                ) : (
                  <Text selectable accessibilityLabel="Exact action">
                    {responseActionText(operation)}
                  </Text>
                )}
              </>
            )}
            {operation && !prompt && (
              <Text style={styles.muted}>
                Run executes this exact action once. Commands use a new terminal. MCP results stay
                on this card.
              </Text>
            )}
            {frozen && (
              <Text>
                The request may have reached the computer. Retry checks the same receipt and will
                not run a direct action twice.
              </Text>
            )}
            {!!draft.stale && <Text>Refresh the review before running. Your prompt stays.</Text>}
            {!!error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
          </View>
        </Sheet>
      )}
    </View>
  )
}
