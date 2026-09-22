import { useEffect, useRef, useState } from 'react'
import { Switch, View } from 'react-native'
import { pullCreateSchema, pullActionResultSchema, pullCreateOptionsSchema } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Sheet } from '../ui/sheet'
import { Field } from '../ui/field'
import { Choice } from '../ui/choice'
import { Action } from '../ui/action'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'

export function CreatePull({
  repositoryId: initial,
  onClose,
  onCreated,
}: {
  repositoryId: string
  onClose: () => void
  onCreated: (repositoryId: string, number: number) => void
}) {
  const { read: call, connected, snapshot } = useRuntime()
  const repos = snapshot?.workspace.repositories ?? []
  const [repositoryId, setRepository] = useState(initial || repos[0]?.id || '')
  const [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [head, setHead] = useState(''),
    [base, setBase] = useState(''),
    [draft, setDraft] = useState(false)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [supportsDraft, setSupportsDraft] = useState(false)
  const [sourceTask, setSourceTask] = useState('')
  const sourceTasks = (snapshot?.workspace.tasks ?? []).filter(
    (task) => task.repositoryId === repositoryId && task.workItem && task.checkoutBranch,
  )
  useEffect(() => {
    let active = true
    setSupportsDraft(false)
    setDraft(false)
    if (repositoryId)
      void call('/api/scm/pulls/options/read', { repositoryId }, pullCreateOptionsSchema)
        .then((value) => {
          if (active) setSupportsDraft(value.draft)
        })
        .catch((cause) => {
          if (active) setError(String(cause))
        })
    return () => {
      active = false
    }
  }, [call, repositoryId])
  const submit = async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const input = pullCreateSchema.parse({ title, body, head, base, draft })
      const result = await call(
        '/api/scm/pulls/create',
        { repositoryId, ...input },
        pullActionResultSchema,
      )
      onCreated(repositoryId, result.number)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <Sheet title="Create pull request" onClose={onClose} busy={busy}>
      <Choice
        label="Project"
        value={repositoryId}
        onChange={(id) => {
          setRepository(id)
          setSourceTask('')
        }}
        disabled={busy}
        items={repos.map((repo) => ({ id: repo.id, name: repo.name }))}
      />
      <Field label="Title" value={title} onChangeText={setTitle} editable={!busy} />
      {!!sourceTasks.length && (
        <Choice
          row
          label="From task"
          value={sourceTask}
          disabled={busy}
          items={[
            { id: '', name: 'Choose a task…' },
            ...sourceTasks.map((task) => ({ id: task.id, name: task.title })),
          ]}
          onChange={(id) => {
            setSourceTask(id)
            const task = sourceTasks.find((task) => task.id === id)
            if (!task?.workItem || !task.checkoutBranch) return
            setTitle(task.workItem.title)
            setHead(task.checkoutBranch)
            setBody(
              `Related ${task.workItem.kind === 'issue' ? 'issue' : 'pipeline'}: ${task.workItem.url}\n\n`,
            )
          }}
        />
      )}
      <Field
        label="Source branch"
        value={head}
        onChangeText={setHead}
        editable={!busy}
        placeholder="feature/my-change"
      />
      <Field
        label="Target branch"
        value={base}
        onChangeText={setBase}
        editable={!busy}
        placeholder="main"
      />
      <Text style={styles.muted}>
        Use branches already pushed to this project. Creating a PR does not push local commits.
      </Text>
      <Field
        label="Description"
        value={body}
        onChangeText={setBody}
        editable={!busy}
        multiline
        style={{ minHeight: 130, textAlignVertical: 'top' }}
      />
      {supportsDraft && (
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={styles.text}>Draft</Text>
          <Switch
            accessibilityLabel="Draft pull request"
            value={draft}
            onValueChange={setDraft}
            disabled={busy}
          />
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Action
        label={busy ? 'Creating…' : 'Create pull request'}
        disabled={busy || !connected || !repositoryId}
        onPress={() => void submit()}
      />
    </Sheet>
  )
}
