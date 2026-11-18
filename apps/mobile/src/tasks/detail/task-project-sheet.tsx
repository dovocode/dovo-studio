import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
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
  orderedThreadInfoSections,
  resolveScopedAgents,
  resolveTaskAgent,
  threadInfoSummarySections,
  taskPullLinks,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'
import { Action } from '../../ui/controls/action'
import { Field } from '../../ui/controls/field'
import { Icon, type IconName } from '../../ui/controls/icon'
import { Sheet, type SheetHandle } from '../../ui/layout/sheet'
import { designTokens } from '@dovo/design'
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
import { ThreadSandboxBadge } from './thread-sandbox'
import { HarnessSettings } from './harness-settings'
import { useMobilePreferences } from '../../runtime/preferences/app-preferences'
import { taskHarnessLabel } from '../creation/harness-choices'
import { ProjectIcon } from '../../scm/connections/project-icon'

function ProjectRow({
  label,
  icon,
  secondary = false,
  detail,
  expanded,
  disabled = false,
  onPress,
}: {
  label: string
  icon?: IconName
  secondary?: boolean
  detail?: string
  expanded?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 10,
        paddingVertical: 6,
        paddingHorizontal: 4,
        backgroundColor: pressed ? colors.elevated : undefined,
        opacity: disabled ? 0.4 : 1,
      })}
    >
      {icon && (
        <View
          style={{
            width: 20,
            height: 24,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={17} color={colors.muted} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text
          numberOfLines={2}
          style={{ color: colors.text, fontSize: 14, fontWeight: secondary ? '400' : '500' }}
        >
          {label}
        </Text>
        {!!detail && (
          <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 12, lineHeight: 17 }}>
            {detail}
          </Text>
        )}
      </View>
      <Icon name={expanded ? 'down' : 'next'} size={14} color={colors.muted} />
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
  onShare,
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
  onShare?: () => void
}) {
  const uiText = useInterfaceText()

  const { snapshot, profile, connected, callEffect } = useRuntime()
  const { colors, styles } = useTheme()
  const { act, busy, error } = useAction()
  const repository = snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)
  const agent = resolveTaskAgent(
    task,
    resolveScopedAgents(
      snapshot?.defaults,
      task.bot ? undefined : repository,
      snapshot?.workspace.agents ?? [],
    ),
  )
  const agentLabel = taskHarnessLabel(task, agent, snapshot?.acpInstallations ?? [])
  const scope = JSON.stringify([profile?.id, task.id])
  const [detailsScope, setDetailsScope] = useState<string>()
  const details = detailsScope === scope
  const [customizing, setCustomizing] = useState(false)
  const summarySection = (id: ThreadInfoSectionId) =>
    threadInfoSummarySections.has(id) &&
    (id !== 'pulls' || taskPullLinks(task).length > 0 || !!task.pullStatus) &&
    (id !== 'changes' || task.files.length > 0)
  const { threadInfoSections, threadInfoOrder } = useMobilePreferences()
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
  const sections = {
    sharing: !task.example && onShare && (
      <ProjectRow
        label={uiText('Share thread')}
        icon="share"
        onPress={() => dismissThen(onShare)}
      />
    ),
    settings: (
      <>
        {show('settings') && (
          <>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 4,
                minHeight: 38,
                display: details || !connected ? 'flex' : 'none',
              }}
            >
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.elevated,
                }}
              >
                <Icon name="device" size={17} color={colors.muted} />
              </View>
              <Text style={{ color: colors.text, fontSize: 14, flex: 1 }}>
                {runtimeComputerName({ profile, snapshot })}
              </Text>
              <View
                accessibilityLabel={connected ? uiText('Connected') : uiText('Offline')}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: connected ? colors.success : colors.muted,
                }}
              />
            </View>
            <ProjectRow
              label={
                modelSettings && details ? uiText('Hide agent & model') : uiText('Agent & model')
              }
              icon="agents"
              detail={agentLabel}
              expanded={modelSettings && details}
              disabled={settingsBusy}
              onPress={() => {
                setModelSettings(!details || !modelSettings)
                setDetailsScope(scope)
              }}
            />
            {modelSettings && (
              <View style={{ display: details ? 'flex' : 'none' }}>
                <HarnessSettings
                  task={task}
                  inline
                  onClose={() => setModelSettings(false)}
                  onBusyChange={setSettingsBusy}
                />
              </View>
            )}
          </>
        )}
      </>
    ),
    usage: (
      <>
        {show('usage') && (
          <>
            <ThreadInfoUsage task={task} detailed={details} />
            <ThreadSandboxBadge task={task} />
          </>
        )}
      </>
    ),
    project: (
      <>
        {show('project') && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View
              style={{
                width: 24,
                height: 24,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {repository ? (
                <ProjectIcon repository={repository} size={24} />
              ) : (
                <Icon name="projects" size={20} color={colors.muted} />
              )}
            </View>
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 }}>
              {repository?.kind === 'scratch'
                ? uiText('No Project')
                : (repository?.name ?? uiText('No Project'))}
            </Text>
            {!details && (
              <Text numberOfLines={2} style={{ color: colors.muted, fontSize: 12, flexShrink: 1 }}>
                {connected
                  ? runtimeComputerName({ profile, snapshot })
                  : uiText('{value0} · Offline', {
                      value0: runtimeComputerName({ profile, snapshot }),
                    })}
              </Text>
            )}
          </View>
        )}
        {show('project') && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Icon name="changes" color={colors.muted} />
              <Text numberOfLines={2} style={{ color: colors.text, fontSize: 13, flex: 1 }}>
                {task.checkoutBranch || repository?.branch || uiText('Project checkout')}
                {repository && !repository.kind && (
                  <Text style={{ color: colors.muted }}>
                    {' · '}
                    {task.execution === 'worktree' ? uiText('Worktree') : uiText('Local checkout')}
                  </Text>
                )}
              </Text>
            </View>
            <View style={{ display: details ? 'flex' : 'none' }}>
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
            </View>
          </>
        )}
        {show('project') && repository && (
          <View style={{ display: details ? 'flex' : 'none' }}>
            <ProjectRow
              secondary
              label={icons ? uiText('Hide project icon') : uiText('Project icon')}
              icon="projects"
              expanded={icons}
              onPress={() => setIcons((value) => !value)}
            />
            {icons && <ProjectIconSettings repository={repository} />}
          </View>
        )}
      </>
    ),
    pulls: (
      <>
        {show('pulls') && (
          <PullStatus task={task} inline onOpen={(url) => dismissThen(() => onPulls(url))} />
        )}
      </>
    ),
    servers: (
      <>
        {show('servers') && onBrowser && (
          <ThreadServers taskId={task.id} onOpen={(url) => dismissThen(() => onBrowser(url))} />
        )}
      </>
    ),
    scripts: (
      <>
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
              label={scripts.length ? uiText('Edit project scripts') : uiText('Add project script')}
              icon="add"
              disabled={!repository || !connected}
              onPress={() => {
                setDrafts(repository?.actions ?? [])
                setEditingScripts(true)
              }}
            />
          </>
        )}
      </>
    ),
    git: (
      <>
        {show('git') && !repository?.kind && (
          <ProjectRow
            secondary
            label={git ? uiText('Hide commit controls') : uiText('Commit & push')}
            icon="changes"
            expanded={git}
            disabled={!repository}
            onPress={() => setGit((value) => !value)}
          />
        )}
        {show('git') && git && <CommitSection task={task} />}
      </>
    ),
    changes: (
      <>
        {show('changes') && (
          <ProjectRow
            secondary
            label={
              task.files.length === 1
                ? uiText('Review 1 changed file')
                : task.files.length > 1
                  ? uiText('Review {value0} changed files', { value0: task.files.length })
                  : uiText('Changes ({value0})', { value0: task.files.length })
            }
            icon="changes"
            onPress={() => dismissThen(onChanges)}
          />
        )}
      </>
    ),
    projects: (
      <>
        {show('projects') && onProjects && (
          <>
            <ProjectRow
              label={
                (task.pendingLinkedCheckouts ?? task.linkedCheckouts)?.length
                  ? uiText('Linked projects ({value0})', {
                      value0: (task.pendingLinkedCheckouts ?? task.linkedCheckouts)?.length,
                    })
                  : uiText('Link projects')
              }
              icon="projects"
              onPress={() => dismissThen(onProjects)}
            />
            <Text style={styles.muted}>
              <InterfaceText>
                {'Use project checkouts or worktrees on this computer.'}
              </InterfaceText>
            </Text>
          </>
        )}
      </>
    ),
    lineage: (
      <>
        {show('lineage') && <TaskSource task={task} />}
        {show('lineage') && !!agents.length && (
          <View style={{ gap: 8 }} accessibilityLabel={uiText('Working subagents')}>
            <Text style={styles.muted}>
              <InterfaceText>{'Working agents'}</InterfaceText>
            </Text>
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
      </>
    ),
    activity: (
      <>
        {show('activity') && (
          <TaskWaitingPanel taskId={task.id} onPull={(url) => dismissThen(() => onPulls(url))} />
        )}
      </>
    ),
  } satisfies Record<Exclude<ThreadInfoSectionId, 'openIn'>, ReactNode>
  return (
    <ProjectPanelFrame
      inline={inline}
      sheet={sheet}
      busy={busy || settingsBusy}
      onClose={onClose}
      headerAction={{
        label: customizing
          ? uiText('Done customizing thread info')
          : uiText('Customize thread info'),
        icon: customizing ? 'check' : 'tune',
        onPress: () => setCustomizing(!customizing),
      }}
    >
      <View accessibilityLabel={uiText('Thread info sections')} style={{ gap: 0 }}>
        <ThreadInfoCustomization inline={inline} open={customizing} onOpenChange={setCustomizing}>
          {inline && (
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>
              <InterfaceText>{'Thread info'}</InterfaceText>
            </Text>
          )}
        </ThreadInfoCustomization>

        {orderedThreadInfoSections(threadInfoOrder).map(
          ({ id, label }) =>
            show(id) &&
            id !== 'openIn' && (
              <View
                key={id}
                accessibilityLabel={label}
                style={[
                  {
                    gap: 6,
                    display: details || summarySection(id) ? 'flex' : 'none',
                    paddingVertical: 4,
                  },
                ]}
              >
                {details && (id === 'settings' || id === 'scripts') && (
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '500' }}>
                    {uiText(label)}
                  </Text>
                )}
                {sections[id]}
              </View>
            ),
        )}
        <ProjectRow
          label={details ? uiText('Hide details') : uiText('More details')}
          expanded={details}
          disabled={busy || settingsBusy}
          onPress={() => setDetailsScope(details ? undefined : scope)}
        />
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </View>
      {editingScripts && repository && (
        <Sheet
          title={uiText('Project scripts')}
          busy={busy}
          onClose={() => setEditingScripts(false)}
        >
          {drafts.map((draft, index) => (
            <View key={draft.id} style={styles.card}>
              <Field
                label={uiText('Script {value0} name', { value0: index + 1 })}
                value={draft.name}
                editable={!busy}
                onChangeText={(name) =>
                  setDrafts((current) =>
                    current.map((item) => (item.id === draft.id ? { ...item, name } : item)),
                  )
                }
              />
              <Field
                label={uiText('Script {value0} command', { value0: index + 1 })}
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
                destructive
                secondary
                label={uiText('Remove script {value0}', { value0: index + 1 })}
                disabled={busy}
                onPress={() =>
                  setDrafts((current) => current.filter((item) => item.id !== draft.id))
                }
              />
            </View>
          ))}
          <Action
            secondary
            label={uiText('Add script')}
            disabled={busy}
            onPress={() =>
              setDrafts((current) => [...current, { id: randomUUID(), name: '', command: '' }])
            }
          />
          <Action
            label={uiText('Save scripts')}
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
  headerAction,
  children,
}: {
  inline: boolean
  sheet: RefObject<SheetHandle | null>
  busy: boolean
  onClose: () => void
  headerAction: { label: string; icon: IconName; onPress: () => void }
  children: ReactNode
}) {
  const uiText = useInterfaceText()
  const { colors } = useTheme()

  if (!inline)
    return (
      <Sheet
        ref={sheet}
        title={uiText('Thread info')}
        busy={busy}
        onClose={onClose}
        headerAction={headerAction}
      >
        {children}
      </Sheet>
    )
  return (
    <View
      accessibilityLabel={uiText('Thread info')}
      style={{
        maxHeight: '42%',
        borderRadius: designTokens.radius.overlay,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12 }}>
        {children}
      </ScrollView>
    </View>
  )
}
