import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { Effect } from 'effect'
import { clientTaskScope } from '@dovo/client-runtime'
import {
  DO_LIMITS,
  decode,
  doDiscoverReplySchema,
  doPlanIssues,
  doRunReplySchema,
  doSaveRequestSchema,
  type DoDiscoverReply,
  type DoPlanItem,
  type DoRun,
  type DoSaveRequest,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { useApplicationState } from '../runtime/state/application-state'
import { SettingsSheet, useSettingsTheme } from '../screens/settings-theme'
import {
  SettingsAction as Action,
  SettingsChoice as Choice,
  SettingsField as Field,
} from '../screens/settings-controls'
import { SettingsSwitchRow } from '../screens/settings-group'
import { Text } from '../ui/content/text'
import { useAction } from '../ui/controls/use-action'
import { withoutDoItem } from './presentation'

export function DoPlanEditor({
  run,
  visible,
  onClose,
  onSaved,
}: {
  run?: DoRun
  visible: boolean
  onClose: () => void
  onSaved: (run: DoRun) => void
}) {
  const { styles } = useSettingsTheme()
  const { connected, snapshot, readEffect, callEffect } = useRuntime()
  const { busy, error, act } = useAction()
  const [draft, setDraft] = useApplicationState<DoSaveRequest>(() => ({
    id: run?.id ?? randomUUID(),
    expectedRevision: run?.revision,
    title: run?.title ?? '',
    goal: run?.goal ?? '',
    maxConcurrency: run?.maxConcurrency ?? DO_LIMITS.defaultConcurrency,
    items: run?.items.map(({ state: _state, ...item }) => item) ?? [],
  }))
  const [catalogs, setCatalogs] = useApplicationState<Record<string, DoDiscoverReply>>({})
  const [discoveryError, setDiscoveryError] = useApplicationState('')
  const [loading, setLoading] = useApplicationState(false)
  const [refresh, setRefresh] = useApplicationState(0)
  const [expanded, setExpanded] = useApplicationState(run?.items[0]?.id ?? '')
  const [validation, setValidation] = useApplicationState('')
  const alive = useRef(true)
  const writable = useRef(false)
  writable.current = visible && connected && snapshot?.doEnabled === true
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const expandedItem = draft.items.find((item) => item.id === expanded)
  const discoverRuntime = expandedItem?.target.runtimeId ?? 'local'
  const discoverProject = expandedItem?.target.repositoryId ?? ''
  useEffect(() => {
    if (!connected || !visible) return
    let active = true
    const scope = clientTaskScope()
    setLoading(true)
    setDiscoveryError('')
    void scope.run(
      Effect.gen(function* () {
        const local = yield* readEffect('/api/do/discover', {}, doDiscoverReplySchema)
        if (active) setCatalogs((current) => ({ ...current, local }))
        const reply =
          discoverRuntime === 'local' && !discoverProject
            ? local
            : yield* readEffect(
                '/api/do/discover',
                {
                  runtimeId: discoverRuntime,
                  ...(discoverProject ? { repositoryId: discoverProject } : {}),
                },
                doDiscoverReplySchema,
              )
        if (active)
          setCatalogs((current) => ({
            ...current,
            [discoverRuntime]: reply,
            [JSON.stringify([discoverRuntime, discoverProject])]: reply,
          }))
      }).pipe(
        Effect.catch((cause) =>
          Effect.sync(() => {
            if (active) setDiscoveryError(cause.message)
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (active) setLoading(false)
          }),
        ),
      ),
    )
    return () => {
      active = false
      void scope.stop()
    }
  }, [connected, visible, readEffect, discoverRuntime, discoverProject, refresh])
  const computers = catalogs.local?.computers ?? []
  const disabled = busy || !connected || !snapshot?.doEnabled
  const updateItem = (id: string, patch: Partial<DoPlanItem>) =>
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }))
  if (!visible) return null
  return (
    <SettingsSheet title={run ? 'Edit Do plan' : 'New Do plan'} busy={busy} onClose={onClose}>
      <Text style={styles.muted}>
        Write a goal and the work each agent should do. Saving keeps a draft. Nothing runs until you
        review the saved plan and tap Start.
      </Text>
      <Field
        label="Plan name"
        value={draft.title}
        maxLength={DO_LIMITS.title}
        editable={!busy}
        onChangeText={(title) => setDraft((current) => ({ ...current, title }))}
      />
      <Field
        label="Goal"
        value={draft.goal}
        multiline
        maxLength={DO_LIMITS.goal}
        editable={!busy}
        placeholder="What should be achieved, and how will you review it?"
        onChangeText={(goal) => setDraft((current) => ({ ...current, goal }))}
      />
      <Choice
        label="Work items at once"
        value={String(draft.maxConcurrency)}
        disabled={busy}
        items={Array.from({ length: DO_LIMITS.maxConcurrency }, (_, index) => ({
          id: String(index + 1),
          name: String(index + 1),
        }))}
        onChange={(value) => setDraft((current) => ({ ...current, maxConcurrency: Number(value) }))}
      />
      <Text style={styles.muted}>
        Keep Studio open on this computer while work runs on paired computers. Each work item has
        its own thread.
      </Text>
      {draft.items.map((item, index) => {
        const catalog = catalogs[item.target.runtimeId]
        const project = catalog?.projects.find((project) => project.id === item.target.repositoryId)
        const computer = computers.find((computer) => computer.id === item.target.runtimeId)
        const agents =
          catalogs[JSON.stringify([item.target.runtimeId, item.target.repositoryId])]?.agents ?? []
        return (
          <View key={item.id} style={styles.card}>
            <Action
              secondary
              label={`${index + 1}. ${item.title || 'New work item'}`}
              onPress={() => {
                setExpanded(expanded === item.id ? '' : item.id)
              }}
            />
            {expanded !== item.id ? (
              <Text style={styles.muted}>
                {computer?.name ??
                  (item.target.runtimeId === 'local' ? 'This computer' : 'Paired computer')}{' '}
                · {project?.name ?? 'Choose a project'}
              </Text>
            ) : (
              <>
                <Field
                  label="Work item name"
                  value={item.title}
                  maxLength={DO_LIMITS.title}
                  editable={!busy}
                  onChangeText={(title) => updateItem(item.id, { title })}
                />
                <Field
                  label="Instructions"
                  value={item.instructions}
                  multiline
                  editable={!busy}
                  maxLength={DO_LIMITS.instructions}
                  placeholder="Describe the work, limits and verification."
                  onChangeText={(instructions) => updateItem(item.id, { instructions })}
                />
                <Choice
                  label="Computer"
                  value={item.target.runtimeId}
                  disabled={disabled}
                  selectedLabel={
                    computer?.name ??
                    (item.target.runtimeId === 'local' ? 'This computer' : 'Unavailable computer')
                  }
                  items={
                    computers.length
                      ? computers.map((computer) => ({ id: computer.id, name: computer.name }))
                      : [{ id: 'local', name: 'This computer' }]
                  }
                  onChange={(runtimeId) => {
                    updateItem(item.id, {
                      target: {
                        runtimeId,
                        repositoryId: '',
                        execution: item.target.execution ?? 'worktree',
                      },
                    })
                  }}
                />
                {loading && discoverRuntime === item.target.runtimeId && (
                  <Text style={styles.muted}>Loading projects and agents…</Text>
                )}
                <Choice
                  label="Project"
                  value={item.target.repositoryId}
                  disabled={disabled || !catalog}
                  items={
                    catalog?.projects.map((project) => ({ id: project.id, name: project.name })) ??
                    []
                  }
                  selectedLabel={project?.name ?? 'Choose a project'}
                  onChange={(repositoryId) =>
                    updateItem(item.id, {
                      target: { ...item.target, repositoryId, agentId: undefined },
                    })
                  }
                />
                {catalog && !catalog.projects.length && (
                  <Text style={styles.muted}>
                    Add a project on this computer before assigning work.
                  </Text>
                )}
                <Choice
                  label="Agent"
                  value={item.target.agentId ?? ''}
                  disabled={disabled || !catalog || loading}
                  selectedLabel={
                    !item.target.agentId
                      ? 'Project default'
                      : (agents.find((agent) => agent.id === item.target.agentId)?.name ??
                        'Unavailable agent')
                  }
                  items={[
                    { id: '', name: 'Project default' },
                    ...agents.map((agent) => ({ id: agent.id, name: agent.name })),
                  ]}
                  onChange={(agentId) =>
                    updateItem(item.id, {
                      target: { ...item.target, agentId: agentId || undefined },
                    })
                  }
                />
                <Choice
                  label="Checkout"
                  value={item.target.execution ?? 'main'}
                  disabled={busy}
                  items={[
                    { id: 'worktree', name: 'New worktree' },
                    { id: 'main', name: 'Local checkout' },
                  ]}
                  onChange={(execution) => {
                    if (execution === 'main' || execution === 'worktree')
                      updateItem(item.id, { target: { ...item.target, execution } })
                  }}
                />
                <Text style={styles.muted}>Start after these work items finish:</Text>
                {draft.items
                  .filter((candidate) => candidate.id !== item.id)
                  .map((candidate) => (
                    <SettingsSwitchRow
                      key={candidate.id}
                      label={candidate.title || 'Untitled work item'}
                      value={item.dependsOn.includes(candidate.id)}
                      disabled={busy}
                      onValueChange={(included) =>
                        updateItem(item.id, {
                          dependsOn: included
                            ? [...item.dependsOn, candidate.id]
                            : item.dependsOn.filter((id) => id !== candidate.id),
                        })
                      }
                    />
                  ))}
                {draft.items.length === 1 && (
                  <Text style={styles.muted}>Add another work item to choose dependencies.</Text>
                )}
                <Action
                  secondary
                  label="Remove work item"
                  disabled={busy}
                  onPress={() =>
                    setDraft((current) => ({
                      ...current,
                      items: withoutDoItem(current.items, item.id),
                    }))
                  }
                />
              </>
            )}
          </View>
        )
      })}
      <Action
        secondary
        label="Add work item"
        disabled={busy || draft.items.length >= DO_LIMITS.items}
        onPress={() => {
          const id = `item-${randomUUID()}`
          setDraft((current) => ({
            ...current,
            items: [
              ...current.items,
              {
                id,
                title: '',
                instructions: '',
                dependsOn: [],
                target: { runtimeId: 'local', repositoryId: '', execution: 'worktree' },
              },
            ],
          }))
          setExpanded(id)
        }}
      />
      {draft.items.length >= DO_LIMITS.items && (
        <Text style={styles.muted}>A plan can contain up to {DO_LIMITS.items} work items.</Text>
      )}
      {doPlanIssues(draft.items).map((issue, index) => (
        <Text key={index} accessibilityRole="alert" style={styles.error}>
          {issue.message}
        </Text>
      ))}
      {!!discoveryError && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={styles.error}>
            {discoveryError}
          </Text>
          <Action
            secondary
            label="Retry computer discovery"
            disabled={disabled || loading}
            onPress={() => setRefresh((value) => value + 1)}
          />
        </View>
      )}
      {!connected && (
        <Text style={styles.muted}>
          This computer is offline. Your draft stays here; reconnect to save.
        </Text>
      )}
      {!!validation && (
        <Text accessibilityRole="alert" style={styles.error}>
          {validation}
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Action
        wide
        label="Save plan"
        disabled={disabled}
        onPress={() => {
          setValidation('')
          let input: DoSaveRequest
          try {
            input = decode(doSaveRequestSchema, {
              ...draft,
              title: draft.title.trim(),
              goal: draft.goal.trim(),
              items: draft.items.map((item) => ({
                ...item,
                title: item.title.trim(),
                instructions: item.instructions.trim(),
              })),
            })
          } catch {
            setValidation(
              'Add a plan name, goal, and at least one named work item with instructions and a project. Dependencies must not form a cycle.',
            )
            return
          }
          act(() =>
            Effect.suspend(() => {
              if (!alive.current || !writable.current) return Effect.void
              return callEffect('/api/do/save', input, doRunReplySchema).pipe(
                Effect.tap(({ run: saved }) =>
                  Effect.sync(() => {
                    if (alive.current) onSaved(saved)
                  }),
                ),
              )
            }),
          )
        }}
      />
    </SettingsSheet>
  )
}
