import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState, useRef, useLayoutEffect } from 'react'
import { View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { responses, worktreeChoicesSchema, type LinkedCheckout, type Task } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Choice } from '../../ui/controls/choice'
import { Field } from '../../ui/controls/field'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function LinkedCheckoutEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: LinkedCheckout[]
  onChange: (links: LinkedCheckout[]) => void
  disabled?: boolean
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const latest = useRef({ value, onChange })
  useLayoutEffect(() => {
    latest.current = { value, onChange }
  }, [value, onChange])
  const update = (id: string, next: LinkedCheckout) => {
    const current = latest.current
    current.onChange(current.value.map((item) => (item.id === id ? next : item)))
  }
  const { snapshot } = useRuntime()
  const projects = snapshot?.workspace.repositories.filter((repo) => repo.kind !== 'scratch') ?? []
  return (
    <View style={{ gap: 12 }}>
      <Text>
        <InterfaceText>{'Linked projects'}</InterfaceText>
      </Text>
      <Text style={styles.muted}>
        <InterfaceText>
          {'Same computer only. Each run creates its own new worktrees.'}
        </InterfaceText>
      </Text>
      {value.map((link) => (
        <LinkedFields
          key={link.id}
          link={link}
          disabled={disabled}
          onChange={(next) => update(link.id, next)}
          onRemove={() => onChange(value.filter((item) => item.id !== link.id))}
        />
      ))}
      <Action
        label={uiText('Add checkout')}
        disabled={disabled || !projects.length || value.length >= 12}
        onPress={() =>
          onChange([
            ...value,
            {
              id: randomUUID(),
              repositoryId: projects[0].id,
              execution: projects[0].kind ? 'main' : 'worktree',
              access: 'read-only',
            },
          ])
        }
      />
    </View>
  )
}

function LinkedFields({
  link,
  disabled,
  onChange,
  onRemove,
}: {
  link: LinkedCheckout
  disabled: boolean
  onChange: (link: LinkedCheckout) => void
  onRemove: () => void
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { snapshot, call } = useRuntime()
  const projects = snapshot?.workspace.repositories.filter((repo) => repo.kind !== 'scratch') ?? []
  const [worktrees, setWorktrees] = useState<Array<{ path: string; branch: string }>>([])
  const generation = useRef(0)
  useLayoutEffect(() => {
    generation.current++
    return () => {
      generation.current++
    }
  }, [call, link.repositoryId])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const repo = projects.find((item) => item.id === link.repositoryId)
  const mode = link.existingWorktreePath ? 'existing' : link.execution
  const choose = async (mode: string) => {
    setError('')
    if (mode !== 'existing') {
      onChange({
        ...link,
        execution: mode === 'main' ? 'main' : 'worktree',
        existingWorktreePath: undefined,
        baseBranch: undefined,
        branch: undefined,
      })
      return
    }
    const currentGeneration = ++generation.current
    setBusy(true)
    try {
      const result = await call(
        '/api/scm/worktrees/choices',
        { repositoryId: link.repositoryId },
        worktreeChoicesSchema,
      )
      if (generation.current !== currentGeneration) return
      setWorktrees(result.worktrees)
      if (!result.worktrees.length) setError(uiText('No worktrees available. Choose New worktree.'))
      else
        onChange({
          ...link,
          execution: 'worktree',
          existingWorktreePath: result.worktrees[0].path,
          baseBranch: undefined,
          branch: undefined,
        })
    } catch (cause) {
      if (generation.current === currentGeneration)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (generation.current === currentGeneration) setBusy(false)
    }
  }
  return (
    <View style={[styles.card, { gap: 10 }]}>
      <Choice
        label={uiText('Linked project')}
        value={link.repositoryId}
        disabled={disabled || busy}
        items={projects.map((repo) => ({ id: repo.id, name: repo.name }))}
        onChange={(repositoryId) => {
          setWorktrees([])
          onChange({
            id: link.id,
            repositoryId,
            access: link.access,
            execution: projects.find((repo) => repo.id === repositoryId)?.kind
              ? 'main'
              : 'worktree',
          })
        }}
      />
      <Choice
        label={uiText('Checkout')}
        value={mode}
        disabled={disabled || busy}
        items={[
          { id: 'main', name: uiText('Main checkout') },
          ...(!repo?.kind
            ? [
                { id: 'worktree', name: uiText('New worktree') },
                { id: 'existing', name: uiText('Existing worktree') },
              ]
            : []),
        ]}
        onChange={(mode) => {
          void choose(mode)
        }}
      />
      {link.existingWorktreePath && (
        <Choice
          label={uiText('Worktree')}
          value={link.existingWorktreePath}
          disabled={disabled || busy}
          items={[
            ...(!worktrees.some((item) => item.path === link.existingWorktreePath)
              ? [{ id: link.existingWorktreePath, name: link.existingWorktreePath }]
              : []),
            ...worktrees.map((item) => ({
              id: item.path,
              name: `${item.branch || 'Detached HEAD'} · ${item.path}`,
            })),
          ]}
          onChange={(existingWorktreePath) => onChange({ ...link, existingWorktreePath })}
        />
      )}
      {mode === 'worktree' && (
        <>
          <Field
            label={uiText('Base branch')}
            placeholder={uiText('Project default')}
            value={link.baseBranch ?? ''}
            editable={!disabled && !busy}
            onChangeText={(baseBranch) =>
              onChange({ ...link, baseBranch: baseBranch || undefined })
            }
          />
          <Field
            label={uiText('Branch name')}
            placeholder={uiText('From thread title')}
            value={link.branch ?? ''}
            editable={!disabled && !busy}
            onChangeText={(branch) => onChange({ ...link, branch: branch || undefined })}
          />
        </>
      )}
      <Choice
        label={uiText('Access')}
        value={link.access}
        disabled={disabled || busy}
        items={[
          { id: 'read-only', name: uiText('Reference only') },
          { id: 'edit', name: uiText('Allow edits') },
        ]}
        onChange={(access) => {
          if (access === 'read-only' || access === 'edit') onChange({ ...link, access })
        }}
      />
      <Action
        destructive
        label={uiText('Remove link')}
        disabled={disabled || busy}
        onPress={onRemove}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}

export function LinkedProjects({ task }: { task: Task }) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { call, connected } = useRuntime()
  const [links, setLinks] = useState(task.pendingLinkedCheckouts ?? task.linkedCheckouts ?? [])
  const [before, setBefore] = useState(task.pendingLinkedCheckouts ?? task.linkedCheckouts ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const disabled =
    !connected ||
    busy ||
    task.status === 'running' ||
    !!task.queue?.length ||
    !!task.delegation ||
    !!task.archivedAt
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await call('/api/tasks/checkouts/save', { id: task.id, before, links }, responses.ok)
      setBefore(links)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: 12 }}>
      {!!task.pendingLinkedCheckouts && (
        <Text style={styles.muted}>
          <InterfaceText>
            {'Linked projects added by the agent take effect on the next turn.'}
          </InterfaceText>
        </Text>
      )}
      <LinkedCheckoutEditor value={links} onChange={setLinks} disabled={disabled} />
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'Removing a link keeps the worktree and saved history. Reference-only access also follows your harness permissions.'
          }
        </InterfaceText>
      </Text>
      <Action
        label={uiText('Save linked projects')}
        disabled={disabled || JSON.stringify(links) === JSON.stringify(before)}
        onPress={() => {
          void save()
        }}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
