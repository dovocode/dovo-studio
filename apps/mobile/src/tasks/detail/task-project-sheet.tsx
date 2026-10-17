import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Effect } from 'effect'
import { randomUUID } from 'expo-crypto'
import {
  indexTaskSubagents,
  subagentMetadata,
  canChangeTaskCheckout,
  repositoryOpenTargets,
  responses,
  runtimeComputerName,
  taskPullLinks,
  workspacePatchResultSchema,
  type ProjectAction,
  type RepositoryOpenTarget,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'
import { Action } from '../../ui/controls/action'
import { Field } from '../../ui/controls/field'
import { Icon, type IconName } from '../../ui/controls/icon'
import { Sheet, type SheetHandle } from '../../ui/layout/sheet'
import { type HeaderAction } from '../../ui/layout/screen-header'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { ProjectIconSettings } from '../../scm/connections/project-icon-settings'
import { TaskWaitingPanel } from './task-waiting-panel'
import { TaskSource } from './task-source'
import { PullStatus } from './pull-status'
import { CommitSection } from './commit-section'

function ProjectRow({
  label,
  icon,
  disabled = false,
  onPress,
}: {
  label: string
  icon?: IconName
  secondary?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        flexShrink: 1,
        flexGrow: 1,
        borderRadius: 8,
        paddingVertical: 8,
        backgroundColor: pressed ? colors.elevated : undefined,
        opacity: disabled ? 0.4 : 1,
      })}
    >
      {icon && <Icon name={icon} size={20} color={colors.muted} />}
      <Text numberOfLines={2} style={{ color: colors.text, fontSize: 16, flex: 1 }}>
        {label}
      </Text>
    </Pressable>
  )
}

export function TaskProjectSheet({
  task,
  inline = false,
  scripts,
  branchActions,
  onChanges,
  onProjects,
  onPulls,
  onAgents,
  onClose,
}: {
  task: Task
  inline?: boolean
  scripts: HeaderAction[]
  branchActions: HeaderAction[]
  onChanges: () => void
  onProjects?: () => void
  onPulls: (url?: string) => void
  onAgents?: () => void
  onClose: () => void
}) {
  const { snapshot, profile, connected, read, callEffect } = useRuntime()
  const { colors, styles } = useTheme()
  const { act, busy, error } = useAction()
  const repository = snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)
  const [targets, setTargets] = useState<string[]>([])
  const [openers, setOpeners] = useState(false)
  const [git, setGit] = useState(false)
  const [editingScripts, setEditingScripts] = useState(false)
  const [drafts, setDrafts] = useState<ProjectAction[]>(() => repository?.actions ?? [])
  const [detectionError, setDetectionError] = useState('')
  const [icons, setIcons] = useState(false)
  const [detected, setDetected] = useState(false)
  useEffect(() => {
    let active = true
    if (!connected) return
    setDetected(false)
    setDetectionError('')
    void read('/api/scm/open-targets', {}, responses.repositoryOpenTargets)
      .then((result) => {
        if (active) {
          setTargets(result.targets)
          setDetected(true)
        }
      })
      .catch((cause) => {
        if (active) {
          setDetectionError(String(cause))
          setDetected(true)
        }
      })
    return () => {
      active = false
    }
  }, [connected, read])
  const folder = targets.includes('explorer')
    ? 'explorer'
    : targets.includes('file-manager')
      ? 'file-manager'
      : 'finder'
  const applications = repositoryOpenTargets(folder).filter(([target]) => targets.includes(target))
  const open = (target: RepositoryOpenTarget) =>
    act(() =>
      callEffect(
        '/api/scm/open-folder',
        { repositoryId: task.repositoryId, taskId: task.id, target },
        responses.ok,
      ).pipe(Effect.tap(() => Effect.sync(() => setOpeners(false)))),
    )
  const checkoutReady =
    !!repository && !task.example && !(task.execution === 'worktree' && canChangeTaskCheckout(task))
  const primary =
    applications.find(([target]) => !['finder', 'explorer', 'file-manager'].includes(target)) ??
    applications[0]
  const indexed = useMemo(
    () => indexTaskSubagents(snapshot?.workspace.tasks ?? []),
    [snapshot?.workspace.tasks],
  )
  const agents = indexed(task, true)
  const pulls = taskPullLinks(task)
  const sheet = useRef<SheetHandle>(null)
  const dismissThen = (action: () => void) => (inline ? action() : sheet.current?.dismiss(action))
  return (
    <ProjectPanelFrame inline={inline} sheet={sheet} busy={busy} onClose={onClose}>
      <View
        accessibilityLabel="Thread project"
        style={[styles.card, { borderRadius: 24, padding: 16, gap: 12 }]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icon name="device" color={colors.muted} />
          <Text style={[styles.text, { flex: 1 }]}>
            {runtimeComputerName({ profile, snapshot })}
          </Text>
        </View>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>
          {repository?.kind === 'scratch' ? 'General' : (repository?.name ?? 'No project')}
        </Text>
        <View style={styles.row}>
          <ProjectRow
            secondary
            icon="code"
            label={
              primary
                ? `Open in ${primary[1]}`
                : detected
                  ? 'No installed editors'
                  : 'Looking for editors…'
            }
            disabled={!connected || busy || !checkoutReady || !primary}
            onPress={() => primary && open(primary[0])}
          />
          <Action
            secondary
            icon="down"
            label="Choose editor"
            disabled={!connected || busy || !checkoutReady || !applications.length}
            onPress={() => setOpeners((value) => !value)}
          />
        </View>
        {openers &&
          applications.map(([target, name]) => (
            <ProjectRow
              key={target}
              secondary
              label={`Open in ${name}`}
              disabled={!connected || busy || !checkoutReady}
              onPress={() => open(target)}
            />
          ))}
        {!!detectionError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {detectionError}
          </Text>
        )}
        {scripts.map((action) => (
          <ProjectRow
            key={action.label}
            secondary
            label={action.label}
            icon="terminal"
            disabled={action.disabled}
            onPress={() => dismissThen(action.onPress)}
          />
        ))}
        <ProjectRow
          secondary
          label={scripts.length ? 'Edit project scripts' : 'Add project script'}
          icon="add"
          disabled={!repository || !connected}
          onPress={() => {
            setDrafts(repository?.actions ?? [])
            setEditingScripts(true)
          }}
        />
        <View style={styles.separator} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icon name="changes" color={colors.muted} />
          <Text numberOfLines={1} style={[styles.text, { flex: 1 }]}>
            {task.checkoutBranch || repository?.branch || 'Project checkout'}
          </Text>
        </View>
        {branchActions.map((action) => (
          <ProjectRow
            key={action.label}
            secondary
            label={action.label}
            icon={action.icon}
            disabled={action.disabled}
            onPress={() => dismissThen(action.onPress)}
          />
        ))}
        <PullStatus
          task={task}
          showLinked={false}
          onOpen={(url) => dismissThen(() => onPulls(url))}
        />
        {!!pulls.length && (
          <ProjectRow
            secondary
            label={`Linked PRs (${pulls.length})`}
            icon="pulls"
            onPress={() => dismissThen(() => onPulls())}
          />
        )}
        {!repository?.kind && (
          <ProjectRow
            secondary
            label={git ? 'Hide commit controls' : 'Commit & push'}
            icon="changes"
            disabled={!repository}
            onPress={() => setGit((value) => !value)}
          />
        )}
        {git && <CommitSection task={task} />}
        <ProjectRow
          secondary
          label={`Changes (${task.files.length})`}
          icon="changes"
          onPress={() => dismissThen(onChanges)}
        />
        {onProjects && (
          <>
            <ProjectRow
              label={
                (task.pendingLinkedCheckouts ?? task.linkedCheckouts)?.length
                  ? `Linked projects (${(task.pendingLinkedCheckouts ?? task.linkedCheckouts)?.length})`
                  : 'Link projects'
              }
              icon="projects"
              onPress={() => dismissThen(onProjects)}
            />
            <Text style={styles.muted}>Use project checkouts or worktrees on this computer.</Text>
          </>
        )}
        <View style={styles.separator} />
        <TaskSource task={task} />
        <TaskWaitingPanel taskId={task.id} onPull={(url) => dismissThen(() => onPulls(url))} />
        {!!agents.length && (
          <View style={{ gap: 8 }} accessibilityLabel="Working subagents">
            <Text style={styles.muted}>Working agents</Text>
            {agents.map((agent) => (
              <ProjectRow
                key={`${agent.provider}:${agent.id}`}
                secondary
                icon="agents"
                label={`${agent.name} · ${subagentMetadata(agent)}`}
                onPress={() => dismissThen(onAgents ?? (() => {}))}
              />
            ))}
          </View>
        )}
        {repository && (
          <>
            <ProjectRow
              secondary
              label={icons ? 'Hide project icon' : 'Project icon'}
              icon="projects"
              onPress={() => setIcons((value) => !value)}
            />
            {icons && <ProjectIconSettings repository={repository} />}
          </>
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </View>
      {editingScripts && repository && (
        <Sheet title="Project scripts" busy={busy} onClose={() => setEditingScripts(false)}>
          {drafts.map((draft, index) => (
            <View key={draft.id} style={styles.card}>
              <Field
                label={`Script ${index + 1} name`}
                value={draft.name}
                editable={!busy}
                onChangeText={(name) =>
                  setDrafts((current) =>
                    current.map((item) => (item.id === draft.id ? { ...item, name } : item)),
                  )
                }
              />
              <Field
                label={`Script ${index + 1} command`}
                value={draft.command}
                multiline
                editable={!busy}
                onChangeText={(command) =>
                  setDrafts((current) =>
                    current.map((item) => (item.id === draft.id ? { ...item, command } : item)),
                  )
                }
              />
              <Action
                secondary
                label={`Remove script ${index + 1}`}
                disabled={busy}
                onPress={() =>
                  setDrafts((current) => current.filter((item) => item.id !== draft.id))
                }
              />
            </View>
          ))}
          <Action
            secondary
            label="Add script"
            disabled={busy}
            onPress={() =>
              setDrafts((current) => [...current, { id: randomUUID(), name: '', command: '' }])
            }
          />
          <Action
            label="Save scripts"
            disabled={
              !connected ||
              busy ||
              drafts.some((draft) => !draft.name.trim() || !draft.command.trim())
            }
            onPress={() =>
              act(() =>
                callEffect(
                  '/api/workspace',
                  {
                    collection: 'repositories',
                    id: repository.id,
                    changes: {
                      actions: {
                        before: repository.actions ?? null,
                        after: drafts.length
                          ? drafts.map((draft) => ({
                              ...draft,
                              name: draft.name.trim(),
                              command: draft.command.trim(),
                            }))
                          : null,
                      },
                    },
                  },
                  workspacePatchResultSchema,
                  'PATCH',
                ).pipe(Effect.tap(() => Effect.sync(() => setEditingScripts(false)))),
              )
            }
          />
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </Sheet>
      )}
    </ProjectPanelFrame>
  )
}

function ProjectPanelFrame({
  inline,
  sheet,
  busy,
  onClose,
  children,
}: {
  inline: boolean
  sheet: RefObject<SheetHandle | null>
  busy: boolean
  onClose: () => void
  children: ReactNode
}) {
  const { colors } = useTheme()
  if (!inline)
    return (
      <Sheet ref={sheet} title="Project information" busy={busy} onClose={onClose}>
        {children}
      </Sheet>
    )
  return (
    <View
      accessibilityLabel="Project information"
      style={{ maxHeight: '42%', borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12 }}>
        {children}
      </ScrollView>
    </View>
  )
}
