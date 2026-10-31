import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Effect } from 'effect'
import { randomUUID } from 'expo-crypto'
import {
  indexTaskSubagents,
  subagentMetadata,
  runtimeComputerName,
  workspacePatchResultSchema,
  type ProjectAction,
  type Task,
  type ThreadInfoSectionId,
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
import { ThreadServers } from './thread-servers'
import { ThreadInfoCustomization } from './thread-info-customization'
import { ThreadInfoUsage } from './thread-info-usage'
import { HarnessSettings } from './harness-settings'
import { useMobilePreferences } from '../../runtime/preferences/app-preferences'

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
  onBrowser,
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
  onBrowser?: (url: string) => void
}) {
  const { snapshot, profile, connected, callEffect } = useRuntime()
  const { colors, styles } = useTheme()
  const { act, busy, error } = useAction()
  const repository = snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)
  const { threadInfoSections } = useMobilePreferences()
  const show = (id: ThreadInfoSectionId) => threadInfoSections[id] !== false
  const [modelSettings, setModelSettings] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [git, setGit] = useState(false)
  const [editingScripts, setEditingScripts] = useState(false)
  const [drafts, setDrafts] = useState<ProjectAction[]>(() => repository?.actions ?? [])
  const [icons, setIcons] = useState(false)
  const indexed = useMemo(
    () => indexTaskSubagents(snapshot?.workspace.tasks ?? []),
    [snapshot?.workspace.tasks],
  )
  const agents = indexed(task, true)
  const sheet = useRef<SheetHandle>(null)
  const dismissThen = (action: () => void) => (inline ? action() : sheet.current?.dismiss(action))
  return (
    <ProjectPanelFrame inline={inline} sheet={sheet} busy={busy || settingsBusy} onClose={onClose}>
      <View
        accessibilityLabel="Thread info sections"
        style={[styles.card, { borderRadius: 24, padding: 16, gap: 12 }]}
      >
        {inline && (
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>Thread info</Text>
        )}
        <ThreadInfoCustomization />
        {show('settings') && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Icon name="device" color={colors.muted} />
              <Text style={[styles.text, { flex: 1 }]}>
                {runtimeComputerName({ profile, snapshot })}
              </Text>
            </View>
            <ProjectRow
              label={modelSettings ? 'Hide agent & model' : 'Agent & model'}
              icon="agents"
              disabled={settingsBusy}
              onPress={() => setModelSettings(!modelSettings)}
            />
            {modelSettings && (
              <HarnessSettings
                task={task}
                inline
                onClose={() => setModelSettings(false)}
                onBusyChange={setSettingsBusy}
              />
            )}
          </>
        )}
        {show('usage') && (
          <>
            <View style={styles.separator} />
            <ThreadInfoUsage task={task} />
          </>
        )}
        {show('project') && (
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>
            {repository?.kind === 'scratch' ? 'No Project' : (repository?.name ?? 'No Project')}
          </Text>
        )}
        {show('pulls') && (
          <PullStatus task={task} inline onOpen={(url) => dismissThen(() => onPulls(url))} />
        )}
        {show('servers') && onBrowser && (
          <ThreadServers taskId={task.id} onOpen={(url) => dismissThen(() => onBrowser(url))} />
        )}
        {show('scripts') && (
          <>
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
          </>
        )}
        {show('project') && (
          <>
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
          </>
        )}
        {show('git') && !repository?.kind && (
          <ProjectRow
            secondary
            label={git ? 'Hide commit controls' : 'Commit & push'}
            icon="changes"
            disabled={!repository}
            onPress={() => setGit((value) => !value)}
          />
        )}
        {show('git') && git && <CommitSection task={task} />}
        {show('changes') && (
          <ProjectRow
            secondary
            label={`Changes (${task.files.length})`}
            icon="changes"
            onPress={() => dismissThen(onChanges)}
          />
        )}
        {show('projects') && onProjects && (
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
        {(show('lineage') || show('activity')) && <View style={styles.separator} />}
        {show('lineage') && <TaskSource task={task} />}
        {show('activity') && (
          <TaskWaitingPanel taskId={task.id} onPull={(url) => dismissThen(() => onPulls(url))} />
        )}
        {show('lineage') && !!agents.length && (
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
        {show('project') && repository && (
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
      <Sheet ref={sheet} title="Thread info" busy={busy} onClose={onClose}>
        {children}
      </Sheet>
    )
  return (
    <View
      accessibilityLabel="Thread info"
      style={{ maxHeight: '42%', borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12 }}>
        {children}
      </ScrollView>
    </View>
  )
}
