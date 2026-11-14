import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { runClientEffect } from '@dovo/client-runtime'
import {
  botCreateSchema,
  botResultSchema,
  decode,
  resolveTaskDefaults,
  runtimeComputerName,
  RuntimeRequestError,
  sameRuntimeConnection,
  type BotCreate,
  type RuntimeConnection,
  type RuntimeOverview,
} from '@dovo/protocol'
import { RuntimeScope, useRuntime, type Runtime } from '../runtime/connection/provider'
import { createDetailDrafts, useDetailDraft } from '../runtime/state/detail-drafts'
import { Sheet } from '../ui/layout/sheet'
import { Action } from '../ui/controls/action'
import { Icon } from '../ui/controls/icon'
import { Text } from '../ui/content/text'
import { useAction } from '../ui/controls/use-action'
import { useTheme } from '../ui/theme'
import { BotFields } from './bot-fields'

/** A request that may have reached its runtime. Body, computer and pairing stay frozen. */
type PendingCreate = { runtimeId: string; connection: RuntimeConnection; input: BotCreate }
/** The text belongs to the user, not to a computer. A host change keeps it intact. */
type CreateDraft = {
  name: string
  role: string
  responsibilities: string
  runtimeId?: string
  pending?: PendingCreate
}
const drafts = createDetailDrafts<CreateDraft>()
const draftKey = 'new-bot'
const emptyDraft = (): CreateDraft => ({ name: '', role: '', responsibilities: '' })

type BotText = Pick<CreateDraft, 'name' | 'role' | 'responsibilities'>
/** Optional examples. A starter fills only empty fields and never replaces typed text. */
const starters: { label: string; text: BotText }[] = [
  {
    label: 'Release',
    text: {
      name: 'Release assistant',
      role: 'Keep releases ready to ship.',
      responsibilities:
        'Investigate failed checks.\nPrepare release notes.\nAsk before publishing.',
    },
  },
  {
    label: 'Research',
    text: {
      name: 'Research assistant',
      role: 'Find clear answers to open questions.',
      responsibilities:
        'Collect sources for each question.\nCompare options and their trade-offs.\nSay what is still uncertain.',
    },
  },
  {
    label: 'Daily brief',
    text: {
      name: 'Daily brief',
      role: 'Show what needs attention each day.',
      responsibilities:
        'Review open work and recent changes.\nList blockers and decisions that are due.\nKeep each brief short.',
    },
  },
]
const textFields = ['name', 'role', 'responsibilities'] as const

/** `offline` is neutral. `action` means the user must update or refresh this computer. */
type HostStatus = {
  ready: boolean
  tone: 'ready' | 'offline' | 'action'
  label: string
  detail: string
}
function hostStatus(entry: RuntimeOverview): HostStatus {
  if (!entry.connected)
    return {
      ready: false,
      tone: 'offline',
      label: 'Offline',
      detail: 'Reconnect this computer to create a Bot.',
    }
  if (!entry.snapshot)
    return {
      ready: false,
      tone: 'offline',
      label: 'Connecting',
      detail: 'Wait for this computer to finish syncing.',
    }
  if (!entry.snapshot.botsSupported)
    return {
      ready: false,
      tone: 'action',
      label: 'Update required',
      detail: 'Update this runtime to create Bots.',
    }
  if (!entry.snapshot.workspace.repositories.some((repository) => repository.kind === 'scratch'))
    return {
      ready: false,
      tone: 'action',
      label: 'Not ready',
      detail: 'This computer cannot safely start a Bot. Refresh its runtime and try again.',
    }
  return { ready: true, tone: 'ready', label: 'Online', detail: '' }
}

/** Whether a frozen request can be sent again without risking a second Bot. */
function pendingStatus(pending: PendingCreate, entry: RuntimeOverview | undefined, name: string) {
  if (!entry)
    return {
      retry: false,
      message: `${name} was removed. The earlier request may already have created this Bot.`,
    }
  // The request stays bound to its exact pairing. A replacement pairing never inherits it.
  if (!sameRuntimeConnection(pending.connection, entry.profile.connection))
    return {
      retry: false,
      message: `${name} was paired again, so Dovo will not resend the earlier request. It may already have created this Bot. Check the Bots on ${name} first.`,
    }
  if (!entry.connected || !entry.snapshot)
    return { retry: false, message: `Reconnect ${name} to retry. Your request is kept.` }
  if (!entry.snapshot.botsSupported)
    return { retry: false, message: `Update ${name} to retry. Your request is kept.` }
  return {
    retry: true,
    message: `Retry sends the original request to ${name}. This prevents a duplicate Bot.`,
  }
}

/** Only an unset destination gets a default: the active computer when ready, else the first ready one. */
function defaultHost(runtime: Runtime) {
  const ready = runtime.overviews.filter((entry) => hostStatus(entry).ready)
  return (ready.find((entry) => entry.profile.id === runtime.activeId) ?? ready[0])?.profile.id
}

/** A reply belongs to the draft only while it still holds this exact request and pairing. */
function holds(current: CreateDraft | undefined, request: PendingCreate) {
  const pending = current?.pending
  return (
    !!pending &&
    pending.input.requestId === request.input.requestId &&
    pending.runtimeId === request.runtimeId &&
    sameRuntimeConnection(pending.connection, request.connection)
  )
}

export function CreateBot({
  onClose,
  onCreated,
}: {
  onClose: () => void
  /** `runtimeId` is the computer that received the request, not the current selection. */
  onCreated: (id: string, runtimeId: string) => void
}) {
  const uiText = useInterfaceText()

  const runtime = useRuntime()
  const { colors, styles } = useTheme()
  const { draft, setField, clear } = useDetailDraft(drafts, draftKey, emptyDraft)
  const { busy, error, act } = useAction()
  const [choosing, setChoosing] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const mounted = useRef(true)
  const overviews = useRef(runtime.overviews)
  overviews.current = runtime.overviews
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const pending = draft.pending
  const fallback = defaultHost(runtime)
  // Fix the default once, so a later status change never moves the Bot to another computer.
  useEffect(() => {
    if (!draft.runtimeId && !draft.pending && fallback) setField('runtimeId', fallback)
  }, [draft.runtimeId, draft.pending, fallback, setField])
  const targetId = pending?.runtimeId ?? draft.runtimeId ?? fallback
  const target = runtime.overviews.find((entry) => entry.profile.id === targetId)
  const targetName = target ? runtimeComputerName(target) : 'This computer'
  const status = target ? hostStatus(target) : undefined
  const frozen = pending ? pendingStatus(pending, target, targetName) : undefined
  useEffect(() => {
    if (!pending) setDiscarding(false)
  }, [pending])
  const blocked = frozen
    ? frozen.message
    : !target
      ? targetId
        ? 'The selected computer is no longer paired. Choose another computer.'
        : runtime.overviews.length
          ? 'No paired computer is ready. Choose a computer when one is online.'
          : 'Pair a computer to create a Bot.'
      : status?.ready
        ? undefined
        : status?.detail
  const canCreate =
    !busy &&
    !!target &&
    !!draft.name.trim() &&
    !!draft.role.trim() &&
    (frozen ? frozen.retry : !!status?.ready)

  const submit = (host: Runtime) =>
    act(async () => {
      const current = drafts.read(draftKey) ?? draft
      const profile = host.profile
      if (!profile || !current.name.trim() || !current.role.trim()) return
      let request = current.pending
      if (request) {
        // Retry only on the exact pairing that may have received the first attempt.
        if (
          request.runtimeId !== profile.id ||
          !sameRuntimeConnection(request.connection, profile.connection)
        )
          throw Error('This computer was paired again. Dovo will not resend the earlier request.')
      } else {
        const repository = host.snapshot?.workspace.repositories.find(
          (item) => item.kind === 'scratch',
        )
        if (!host.snapshot?.botsSupported || !repository)
          throw Error('This computer cannot safely start a Bot. Refresh its runtime and try again.')
        // Fresh IDs and this host's own defaults. Nothing carries over from another computer.
        request = {
          runtimeId: profile.id,
          connection: profile.connection,
          input: decode(botCreateSchema, {
            requestId: randomUUID(),
            createTask: {
              ...resolveTaskDefaults(host.snapshot.defaults, undefined),
              id: randomUUID(),
              title: current.name.trim(),
              repositoryId: repository.id,
              execution: 'main',
              worktreeFromOrigin: false,
              setupCommand: undefined,
              submodules: undefined,
              agentId: '',
              status: 'draft',
              createdAt: new Date().toISOString(),
              messages: [],
              files: [],
              draft: '',
              example: false,
            },
            role: current.role.trim(),
            responsibilities: current.responsibilities,
          }),
        }
      }
      const sent = request
      setField('pending', sent)
      const owns = () => holds(drafts.read(draftKey), sent)
      try {
        const result = await runClientEffect(
          host.callEffect('/api/bots/create', sent.input, botResultSchema),
        )
        await host.refresh()
        // A late reply must not close or redirect a draft that has moved on.
        if (!owns()) return
        // Without the open sheet, the current pairing cannot be checked. Keep the frozen
        // request: a retry on the same pairing replays this request ID and returns the same Bot.
        if (!mounted.current) return
        const receiver = overviews.current.find((entry) => entry.profile.id === sent.runtimeId)
        if (!receiver || !sameRuntimeConnection(receiver.profile.connection, sent.connection))
          throw Error(
            'The Bot was created, but its computer was paired again or removed. Dovo kept your text. Open the Bot from that computer’s Bots.',
          )
        clear()
        onCreated(result.id, sent.runtimeId)
      } catch (failure) {
        if (failure instanceof RuntimeRequestError && failure.mutationRejected === true && owns())
          setField('pending', undefined)
        throw failure
      }
    })

  return (
    <Sheet
      title={uiText('New Bot')}
      busy={busy}
      onClose={onClose}
      footer={
        <View style={{ gap: 8 }}>
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          {!!blocked && !discarding && (
            <Text accessibilityRole={frozen ? undefined : 'alert'} style={styles.muted}>
              {blocked}
            </Text>
          )}
          {pending && !frozen?.retry && !discarding && (
            <Action
              label="Discard earlier request"
              secondary
              disabled={busy}
              onPress={() => setDiscarding(true)}
            />
          )}
          {pending && !frozen?.retry && discarding && (
            <View
              accessibilityRole="alert"
              style={[styles.card, { gap: 10, borderColor: colors.warning }]}
            >
              <Text style={styles.text}>
                {`The earlier request may already have created this Bot on ${targetName}. Check its Bots first. A new request can make a second Bot.`}
              </Text>
              <Action
                label="Keep earlier request"
                secondary
                disabled={busy}
                onPress={() => setDiscarding(false)}
              />
              <Action
                label="Discard and allow a new request"
                secondary
                disabled={busy}
                onPress={() => setField('pending', undefined)}
              />
            </View>
          )}
          {target ? (
            <RuntimeScope runtimeId={target.profile.id}>
              <CreateButton retry={!!pending} disabled={!canCreate} onPress={submit} />
            </RuntimeScope>
          ) : (
            <Action
              label={pending ? 'Retry Create Bot' : 'Create Bot'}
              wide
              disabled
              onPress={() => undefined}
            />
          )}
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            You can change the model and tool permissions in Bot settings later.
          </Text>
        </View>
      }
    >
      <View style={{ gap: 20 }}>
        <View style={{ gap: 6 }}>
          <Text accessibilityRole="header" style={styles.largeTitle}>
            Create your Bot
          </Text>
          <Text style={[styles.text, { color: colors.muted }]}>
            One conversation. Its own memory. A role that lasts.
          </Text>
        </View>
        <RunsOn
          overviews={runtime.overviews}
          selected={target}
          locked={!!pending}
          disabled={busy}
          open={choosing && !pending}
          onToggle={() => setChoosing(!choosing)}
          onSelect={(id) => {
            setField('runtimeId', id)
            setChoosing(false)
          }}
        />
        <Starters
          draft={draft}
          disabled={busy || !!pending}
          onFill={(text) => {
            for (const field of textFields)
              if (!draft[field].trim() && text[field]) setField(field, text[field])
          }}
        />
        <View style={[styles.card, { padding: 16, gap: 0 }]}>
          <BotFields
            {...draft}
            disabled={busy || !!pending}
            onName={(value) => setField('name', value)}
            onRole={(value) => setField('role', value)}
            onResponsibilities={(value) => setField('responsibilities', value)}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <Icon name="checkCircle" size={18} color={colors.success} />
          <Text style={[styles.muted, { flex: 1, fontSize: 15, lineHeight: 21 }]}>
            Each Bot gets one lasting conversation, private memory, routines and tools. Closing this
            sheet keeps your text.
          </Text>
        </View>
      </View>
    </Sheet>
  )
}

/** Optional starter roles. Shown only while at least one field is still empty. */
function Starters({
  draft,
  disabled,
  onFill,
}: {
  draft: BotText
  disabled: boolean
  onFill: (text: BotText) => void
}) {
  const { colors, styles } = useTheme()
  if (textFields.every((field) => draft[field].trim())) return null
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.muted}>Optional: start from a suggested role</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {starters.map((starter) => (
          <Pressable
            key={starter.label}
            accessibilityRole="button"
            accessibilityLabel={`Use ${starter.label} starter`}
            accessibilityHint="Fills only the empty fields."
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onFill(starter.text)}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: 'center',
              paddingHorizontal: 16,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.selection : colors.surface,
              opacity: disabled ? 0.5 : 1,
              maxWidth: '100%',
            })}
          >
            <Text style={[styles.text, { fontSize: 15 }]}>{starter.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

/** Rendered inside the selected host's RuntimeScope, so the request uses that pairing. */
function CreateButton({
  retry,
  disabled,
  onPress,
}: {
  retry: boolean
  disabled: boolean
  onPress: (host: Runtime) => void
}) {
  const host = useRuntime()
  return (
    <Action
      label={retry ? 'Retry Create Bot' : 'Create Bot'}
      wide
      disabled={disabled}
      onPress={() => onPress(host)}
    />
  )
}

function RunsOn({
  overviews,
  selected,
  locked,
  disabled,
  open,
  onToggle,
  onSelect,
}: {
  overviews: RuntimeOverview[]
  selected: RuntimeOverview | undefined
  locked: boolean
  disabled: boolean
  open: boolean
  onToggle: () => void
  onSelect: (runtimeId: string) => void
}) {
  const { colors, styles } = useTheme()
  const name = selected ? runtimeComputerName(selected) : 'Choose a computer'
  const status = selected ? hostStatus(selected) : undefined
  return (
    <View style={[styles.card, { padding: 4, gap: 0 }]}>
      <Text style={[styles.muted, { paddingHorizontal: 12, paddingTop: 10, fontSize: 15 }]}>
        Runs on
      </Text>
      <Pressable
        testID="Runs on"
        accessibilityRole="button"
        accessibilityLabel={`Runs on ${name}, ${status?.label ?? 'unavailable'}${locked ? '' : '. Change computer'}`}
        accessibilityState={{ expanded: open, disabled: disabled || locked }}
        disabled={disabled || locked}
        onPress={onToggle}
        style={({ pressed }) => ({
          minHeight: 60,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 12,
          backgroundColor: pressed ? colors.selection : 'transparent',
        })}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.selection,
            flexShrink: 0,
          }}
        >
          <Icon name="device" size={22} color={colors.text} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[styles.text, { fontSize: 17, fontWeight: '700' }]}>{name}</Text>
          {status && <StatusLine status={status} />}
        </View>
        {!locked && (
          <View style={{ flexShrink: 0, transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
            <Icon name="down" size={20} color={colors.muted} />
          </View>
        )}
      </Pressable>
      {!locked && (
        <Text style={[styles.muted, { paddingHorizontal: 12, paddingBottom: 10 }]}>
          This computer hosts your Bot and runs its work.
        </Text>
      )}
      {locked && (
        <Text style={[styles.muted, { paddingHorizontal: 12, paddingBottom: 8 }]}>
          The computer stays fixed until this request finishes.
        </Text>
      )}
      {open && (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Choose a computer"
          style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 4 }}
        >
          {overviews.map((entry) => {
            const entryStatus = hostStatus(entry)
            const entryName = runtimeComputerName(entry)
            const checked = entry.profile.id === selected?.profile.id
            return (
              <Pressable
                key={entry.profile.id}
                testID={`Run on ${entryName}`}
                accessibilityRole="radio"
                accessibilityLabel={`${entryName}, ${entryStatus.label}`}
                accessibilityState={{ checked, disabled: disabled || !entryStatus.ready }}
                disabled={disabled || !entryStatus.ready}
                onPress={() => onSelect(entry.profile.id)}
                style={({ pressed }) => ({
                  minHeight: 48,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 12,
                  backgroundColor: checked ? colors.selection : 'transparent',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text
                    style={[styles.text, { color: entryStatus.ready ? colors.text : colors.muted }]}
                  >
                    {entryName}
                  </Text>
                  <StatusLine status={entryStatus} />
                </View>
                <View style={{ width: 24, flexShrink: 0, alignItems: 'center' }}>
                  {checked && <Icon name="check" size={18} color={colors.accent} />}
                </View>
              </Pressable>
            )
          })}
        </View>
      )}
    </View>
  )
}

function StatusLine({ status }: { status: HostStatus }) {
  const { colors, styles } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          flexShrink: 0,
          backgroundColor: { ready: colors.success, offline: colors.muted, action: colors.warning }[
            status.tone
          ],
        }}
      />
      <Text style={[styles.muted, { flexShrink: 1 }]}>{status.label}</Text>
    </View>
  )
}
