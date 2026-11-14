import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Choice } from '../ui/controls/choice'
import { taskHref } from '../shell/task-route'
import { BotSkillProposals } from './bot-skill-proposals'
import { BotAvatarEditor } from './bot-avatar-editor'
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import { automationHref } from '../shell/source-route'
import { Sheet, useSheetNavigation } from '../ui/layout/sheet'
import { runClientEffect } from '@dovo/client-runtime'
import {
  botResultSchema,
  responses,
  botRoutines,
  botWorkInbox,
  botRunStatusLabels,
  workspacePatchResultSchema,
  emptyBotResources,
  taskResources,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { detailDraftKey } from '../runtime/state/detail-drafts'
import { HarnessSettings } from '../tasks/detail/harness-settings'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { BotEditor } from './bot-editor'
import { BotResources } from './bot-resources'
import { BotMemory } from './bot-memory'
import { useAction } from '../ui/controls/use-action'

export type BotSection = 'settings' | 'mcp' | 'skill' | 'memory' | 'routines'

export function BotSettings(props: {
  task: Task
  onClose: () => void
  onDeleted?: () => void
  initialSection?: BotSection
}) {
  const { profile } = useRuntime()
  return (
    <BotSettingsEditor
      key={detailDraftKey(
        profile?.connection ?? null,
        'bot-settings',
        props.task.id,
        props.initialSection ?? 'settings',
      )}
      {...props}
    />
  )
}
function BotSettingsEditor({
  task,
  onClose,
  onDeleted,
  initialSection = 'settings',
}: {
  task: Task
  onClose: () => void
  onDeleted?: () => void
  initialSection?: BotSection
}) {
  const uiText = useInterfaceText()

  const { profile, connected, snapshot, callEffect } = useRuntime()
  const { act, busy, error } = useAction()
  const [deleting, setDeleting] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [harness, setHarness] = useState(false)
  const [avatar, setAvatar] = useState(false)
  const [resources, setResources] = useState<'mcp' | 'skill' | undefined>(
    initialSection === 'mcp' || initialSection === 'skill' ? initialSection : undefined,
  )
  const [memory, setMemory] = useState(initialSection === 'memory')
  const [routines, setRoutines] = useState(initialSection === 'routines')
  const [revision] = useState(task.bot?.revision)
  const title = useRef(task.title)
  const currentRevision = useRef(revision)
  const baseline = useRef(task.bot)
  const bot = task.bot
  if (!bot) return null
  return (
    <BotEditor
      draftKey={detailDraftKey(profile?.connection ?? null, 'bot', task.id)}
      initial={{
        name: task.title,
        role: bot.role,
        responsibilities: bot.responsibilities,
        backupAgentId: bot.backupAgentId ?? '',
        originalBackupAgentId: bot.backupAgentId ?? '',
        expectedRevision: bot.revision,
        resources: bot.resources ?? emptyBotResources(),
        originalName: task.title,
        originalRole: bot.role,
        originalResponsibilities: bot.responsibilities,
      }}
      unavailable={
        !connected
          ? 'Reconnect this computer to save Bot settings.'
          : snapshot?.botsSupported !== true
            ? 'Update this runtime to use Bots.'
            : undefined
      }
      onClose={onClose}
      onSave={async (value, retain) => {
        if (value.name !== (value.originalName ?? title.current)) {
          const renamed = await runClientEffect(
            callEffect(
              '/api/workspace',
              {
                collection: 'tasks',
                action: 'update',
                id: task.id,
                changes: {
                  title: { before: value.originalName ?? title.current, after: value.name },
                },
              },
              workspacePatchResultSchema,
              'PATCH',
            ),
          )
          if (
            renamed.outcome === 'rejected' ||
            renamed.outcome === 'reconciled' ||
            renamed.reconciled
          )
            throw Error('Bot name changed. Your draft is kept. Refresh before saving again.')
          title.current = value.name
          retain({ originalName: value.name })
        }
        if (
          JSON.stringify(value.resources) !==
            JSON.stringify(baseline.current?.resources ?? emptyBotResources()) ||
          value.backupAgentId !==
            (value.originalBackupAgentId ?? baseline.current?.backupAgentId ?? '') ||
          value.role !== (value.originalRole ?? baseline.current?.role) ||
          value.responsibilities !==
            (value.originalResponsibilities ?? baseline.current?.responsibilities)
        ) {
          const result = await runClientEffect(
            callEffect(
              '/api/bots/update',
              {
                id: task.id,
                expectedRevision: value.expectedRevision ?? currentRevision.current,
                role: value.role,
                ...(snapshot?.botResourcesSupported ? { resources: value.resources } : {}),
                responsibilities: value.responsibilities,
                ...(snapshot?.botBackupSupported
                  ? { backupAgentId: value.backupAgentId || null }
                  : {}),
              },
              botResultSchema,
            ),
          )
          currentRevision.current = result.bot.revision
          baseline.current = result.bot
          retain({
            expectedRevision: result.bot.revision,
            originalRole: result.bot.role,
            originalResponsibilities: result.bot.responsibilities,
            originalBackupAgentId: result.bot.backupAgentId ?? '',
          })
        }
      }}
    >
      {(draft, retain) => (
        <>
          <View style={{ gap: 12 }}>
            <Text>
              {bot.state === 'paused'
                ? uiText('Paused. New messages stay queued until you resume.')
                : uiText('Active. This Bot keeps one conversation across its work.')}
            </Text>
            {!!error && <Text accessibilityRole="alert">{error}</Text>}
            <Action
              label={bot.state === 'paused' ? uiText('Resume Bot') : uiText('Pause Bot')}
              disabled={!connected || busy || !snapshot?.botsSupported}
              onPress={() =>
                act(async () => {
                  const result = await runClientEffect(
                    callEffect(
                      '/api/bots/lifecycle',
                      {
                        id: task.id,
                        action: bot.state === 'paused' ? 'resume' : 'pause',
                        expectedRevision: bot.revision,
                      },
                      botResultSchema,
                    ),
                  )
                  // A no-op may acknowledge an external edit. Advance only our own unchanged baseline.
                  if (
                    draft.expectedRevision === bot.revision &&
                    result.bot.role === bot.role &&
                    result.bot.responsibilities === bot.responsibilities &&
                    result.bot.backupAgentId === bot.backupAgentId &&
                    JSON.stringify(result.bot.resources ?? emptyBotResources()) ===
                      JSON.stringify(bot.resources ?? emptyBotResources())
                  )
                    retain({ expectedRevision: result.bot.revision })
                })
              }
            />
            <Text>
              <InterfaceText>
                {
                  'Pause holds new work. The current turn can finish. Use Stop in the chat to cancel it.'
                }
              </InterfaceText>
            </Text>
            {snapshot?.botBackupSupported && (
              <>
                <Choice
                  label={uiText('Automatic backup')}
                  value={draft.backupAgentId || 'none'}
                  disabled={!connected || busy}
                  items={[
                    { id: 'none', name: uiText('No backup') },
                    ...(snapshot?.workspace.agents ?? []).map((agent) => ({
                      id: agent.id,
                      name: `${agent.name} · ${agent.model}`,
                    })),
                  ]}
                  onChange={(id) => retain({ backupAgentId: id === 'none' ? '' : id })}
                />
                <Text>
                  <InterfaceText>
                    {
                      'Use this saved agent after a quota or provider outage, only before work starts. Access stays the same. The backup becomes the current model and can have different costs.'
                    }
                  </InterfaceText>
                </Text>
              </>
            )}
            <Action label={uiText('Avatar')} secondary onPress={() => setAvatar(true)} />
            <Action
              label={uiText('Harness, model and tool permissions')}
              secondary
              onPress={() => setHarness(true)}
            />
            {snapshot?.botResourcesSupported && (
              <>
                <Action
                  label={uiText('MCP servers')}
                  secondary
                  onPress={() => setResources('mcp')}
                />
                <Action label={uiText('Skills')} secondary onPress={() => setResources('skill')} />
              </>
            )}
            <Action label={uiText('Routines')} secondary onPress={() => setRoutines(true)} />
            <Action label={uiText('Memory')} secondary onPress={() => setMemory(true)} />
            <Action
              destructive
              label={uiText('Delete Bot…')}
              secondary
              disabled={
                !connected ||
                busy ||
                !snapshot?.botsSupported ||
                task.status === 'running' ||
                !!task.activeRunId
              }
              onPress={() => setDeleting(true)}
            />
          </View>
          {deleting && (
            <Sheet
              title={uiText('Delete Bot?')}
              busy={busy}
              onClose={() => {
                if (!busy) setDeleting(false)
              }}
            >
              <Text>
                <InterfaceText values={{ value0: task.title }}>
                  {
                    'Permanently delete “{value0}”, its conversation, private memory and local child threads? Repository files and worktrees stay. Saved routines stay, but their Bot jobs need a new target. Stop active work and close terminals first.'
                  }
                </InterfaceText>
              </Text>
              <BotDeletionResult deleted={deleted} busy={busy} onDeleted={onDeleted} />
              {!!error && <Text accessibilityRole="alert">{error}</Text>}
              <Action
                label={uiText('Cancel')}
                secondary
                disabled={busy}
                onPress={() => setDeleting(false)}
              />
              <Action
                destructive
                label={uiText('Delete Bot')}
                disabled={
                  !connected ||
                  busy ||
                  !snapshot?.botsSupported ||
                  task.status === 'running' ||
                  !!task.activeRunId
                }
                onPress={() =>
                  act(async () => {
                    await runClientEffect(
                      callEffect(
                        '/api/tasks/lifecycle',
                        { id: task.id, action: 'delete', removeWorktrees: false },
                        responses.ok,
                      ),
                    )
                    if (mounted.current) setDeleted(true)
                  })
                }
              />
            </Sheet>
          )}
          {avatar && (
            <BotAvatarEditor
              task={task}
              onClose={() => setAvatar(false)}
              onSaved={(result) => {
                if (
                  draft.expectedRevision === bot.revision &&
                  result.bot.role === bot.role &&
                  result.bot.responsibilities === bot.responsibilities
                ) {
                  currentRevision.current = result.bot.revision
                  baseline.current = result.bot
                  retain({ expectedRevision: result.bot.revision })
                }
              }}
            />
          )}
          {harness && <HarnessSettings task={task} onClose={() => setHarness(false)} />}
          {memory && <BotMemory taskId={task.id} onClose={() => setMemory(false)} />}
          {routines && (
            <Sheet title={uiText('Routines')} onClose={() => setRoutines(false)}>
              <BotRoutines taskId={task.id} />
            </Sheet>
          )}
          {resources && snapshot?.botResourcesSupported && (
            <BotResources
              kind={resources}
              children={
                resources === 'skill' ? (
                  <BotSkillProposals
                    task={task}
                    onSaved={(result) => {
                      if (
                        draft.expectedRevision === bot.revision &&
                        JSON.stringify(draft.resources ?? emptyBotResources()) ===
                          JSON.stringify(bot.resources ?? emptyBotResources())
                      ) {
                        currentRevision.current = result.bot.revision
                        baseline.current = result.bot
                        retain({
                          expectedRevision: result.bot.revision,
                          resources: result.bot.resources ?? emptyBotResources(),
                        })
                      }
                    }}
                  />
                ) : undefined
              }
              value={draft.resources ?? emptyBotResources()}
              inherited={taskResources(
                {
                  ...task,
                  bot: task.bot ? { ...task.bot, resources: undefined } : undefined,
                  repositoryId: '',
                },
                snapshot.workspace,
                snapshot.defaults,
              )}
              disabled={!connected}
              onClose={() => setResources(undefined)}
              save={async (update) => {
                retain({ resources: update(draft.resources ?? emptyBotResources()) })
              }}
            />
          )}
        </>
      )}
    </BotEditor>
  )
}

function BotRoutines({ taskId }: { taskId: string }) {
  const uiText = useInterfaceText()

  const { snapshot, profile } = useRuntime()
  const navigate = useSheetNavigation()
  const task = snapshot?.workspace.tasks.find((t) => t.id === taskId)
  const inbox = task
    ? botWorkInbox(
        task,
        snapshot?.workspace.tasks ?? [],
        snapshot?.workspace.automations ?? [],
        snapshot?.runs ?? [],
        [...(snapshot?.approvals ?? []), ...(snapshot?.questions ?? [])].map(
          (input) => input.taskId,
        ),
      )
    : []
  const routines = botRoutines(taskId, snapshot?.workspace.automations ?? [], snapshot?.runs ?? [])
  return (
    <View style={{ gap: 8 }}>
      <Text>
        <InterfaceText>{'Work inbox'}</InterfaceText>
      </Text>
      <Text>
        <InterfaceText>
          {'Workers run separately. Your conversation stays available.'}
        </InterfaceText>
      </Text>
      {inbox.map((item) => (
        <Action
          key={item.key}
          secondary
          disabled={!profile}
          label={item.title + ' · ' + item.status}
          onPress={() => {
            if (profile)
              navigate(() =>
                router.navigate(
                  item.taskId
                    ? taskHref(profile.id, item.taskId)
                    : automationHref(profile.id, item.automationId!, item.runId),
                ),
              )
          }}
        />
      ))}
      {!inbox.length && (
        <Text>
          <InterfaceText>{'No work yet.'}</InterfaceText>
        </Text>
      )}
      <Text>
        <InterfaceText
          values={{
            value0: routines.length
              ? uiText('{value0} {value1} this Bot.', {
                  value0: routines.length,
                  value1: routines.length === 1 ? 'routine uses' : 'routines use',
                })
              : uiText('No routines use this Bot.'),
          }}
        >
          {'Routines are optional. {value0}'}
        </InterfaceText>
      </Text>
      {routines.map(({ flow, triggers, steps, runs }) => (
        <View key={flow.id} style={{ gap: 8 }}>
          <Action
            label={`${flow.name}${flow.enabled ? '' : uiText(' · Disabled')}`}
            secondary
            disabled={!profile}
            onPress={() => {
              if (profile) navigate(() => router.navigate(automationHref(profile.id, flow.id)))
            }}
          />
          <Text>{triggers.join(' · ') || uiText('No trigger configured')}</Text>
          {steps.map((step) => (
            <Text key={step.id}>
              {step.label} ·{' '}
              {step.botJob
                ? uiText('This Bot')
                : step.review
                  ? uiText('Human review')
                  : step.botId
                    ? uiText('Bot job')
                    : uiText('Agent task')}
            </Text>
          ))}
          {!runs.length && (
            <Text>
              <InterfaceText>{'No runs yet.'}</InterfaceText>
            </Text>
          )}
          {runs.slice(0, 3).map((run) => (
            <Action
              key={run.id}
              secondary
              disabled={!profile}
              label={`${botRunStatusLabels[run.status]} · ${new Date(run.createdAt).toLocaleString()}`}
              onPress={() => {
                if (profile)
                  navigate(() => router.navigate(automationHref(profile.id, flow.id, run.id)))
              }}
            />
          ))}
        </View>
      ))}
      <Action
        label={uiText('Manage routines')}
        secondary
        onPress={() => navigate(() => router.navigate('/settings/automations'))}
      />
    </View>
  )
}

/** Dismiss both native sheets before navigating away from the deleted conversation. */
function BotDeletionResult({
  deleted,
  busy,
  onDeleted,
}: {
  deleted: boolean
  busy: boolean
  onDeleted?: () => void
}) {
  const navigate = useSheetNavigation()
  const handled = useRef(false)
  useEffect(() => {
    if (!deleted || busy || handled.current) return
    handled.current = true
    navigate(() => onDeleted?.())
  }, [deleted, busy, navigate, onDeleted])
  return null
}
