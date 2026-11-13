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
          })
        }
      }}
    >
      {(draft, retain) => (
        <>
          <View style={{ gap: 12 }}>
            <Text>
              {bot.state === 'paused'
                ? 'Paused. New messages stay queued until you resume.'
                : 'Active. This Bot keeps one conversation across its work.'}
            </Text>
            {!!error && <Text accessibilityRole="alert">{error}</Text>}
            <Action
              label={bot.state === 'paused' ? 'Resume Bot' : 'Pause Bot'}
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
                    JSON.stringify(result.bot.resources ?? emptyBotResources()) ===
                      JSON.stringify(bot.resources ?? emptyBotResources())
                  )
                    retain({ expectedRevision: result.bot.revision })
                })
              }
            />
            <Text>
              Pause holds new work. The current turn can finish. Use Stop in the chat to cancel it.
            </Text>
            <Action label="Bot avatar" secondary onPress={() => setAvatar(true)} />
            <Action
              label="Harness, model and tool permissions"
              secondary
              onPress={() => setHarness(true)}
            />
            {snapshot?.botResourcesSupported && (
              <>
                <Action label="Bot MCP servers" secondary onPress={() => setResources('mcp')} />
                <Action label="Bot skills" secondary onPress={() => setResources('skill')} />
              </>
            )}
            <Action label="Bot routines" secondary onPress={() => setRoutines(true)} />
            <Action label="Bot memory" secondary onPress={() => setMemory(true)} />
            <Action
              label="Delete Bot…"
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
              title="Delete Bot?"
              busy={busy}
              onClose={() => {
                if (!busy) setDeleting(false)
              }}
            >
              <Text>
                Permanently delete “{task.title}”, its conversation, private memory and local child
                threads? Repository files and worktrees stay. Saved routines stay, but their Bot
                jobs need a new target. Stop active work and close terminals first.
              </Text>
              <BotDeletionResult deleted={deleted} busy={busy} onDeleted={onDeleted} />
              {!!error && <Text accessibilityRole="alert">{error}</Text>}
              <Action label="Cancel" secondary disabled={busy} onPress={() => setDeleting(false)} />
              <Action
                label="Delete Bot"
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
            <Sheet title="Bot routines" onClose={() => setRoutines(false)}>
              <BotRoutines taskId={task.id} />
            </Sheet>
          )}
          {resources && snapshot?.botResourcesSupported && (
            <BotResources
              kind={resources}
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
  const { snapshot, profile } = useRuntime()
  const navigate = useSheetNavigation()
  const routines = botRoutines(taskId, snapshot?.workspace.automations ?? [], snapshot?.runs ?? [])
  return (
    <View style={{ gap: 8 }}>
      <Text>
        Routines are optional.{' '}
        {routines.length
          ? `${routines.length} ${routines.length === 1 ? 'routine uses' : 'routines use'} this Bot.`
          : 'No routines use this Bot.'}
      </Text>
      {routines.map(({ flow, triggers, steps, runs }) => (
        <View key={flow.id} style={{ gap: 8 }}>
          <Action
            label={`${flow.name}${flow.enabled ? '' : ' · Disabled'}`}
            secondary
            disabled={!profile}
            onPress={() => {
              if (profile) navigate(() => router.navigate(automationHref(profile.id, flow.id)))
            }}
          />
          <Text>{triggers.join(' · ') || 'No trigger configured'}</Text>
          {steps.map((step) => (
            <Text key={step.id}>
              {step.label} ·{' '}
              {step.botJob
                ? 'This Bot'
                : step.review
                  ? 'Human review'
                  : step.botId
                    ? 'Bot job'
                    : 'Agent task'}
            </Text>
          ))}
          {!runs.length && <Text>No runs yet.</Text>}
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
        label="Manage routines"
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
