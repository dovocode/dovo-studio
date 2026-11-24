import { useState } from 'react'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Pressable, View } from 'react-native'
import { botResultSchema, botWorkSummary, taskIsWorking, type Task } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { Text } from '../ui/content/text'
import { Action } from '../ui/controls/action'
import { Icon, type IconName } from '../ui/controls/icon'
import { useAction } from '../ui/controls/use-action'
import { Sheet } from '../ui/layout/sheet'
import { useTheme } from '../ui/theme'

export function BotWorkSummary(props: {
  task: Task
  onRoutines: () => void
  onWorkers: () => void
}) {
  const { profile } = useRuntime()
  return (
    <BotWorkControls
      key={JSON.stringify([profile?.id, profile?.connection, props.task.id])}
      {...props}
    />
  )
}
function BotWorkControls({
  task,
  onRoutines,
  onWorkers,
}: {
  task: Task
  onRoutines: () => void
  onWorkers: () => void
}) {
  const uiText = useInterfaceText()
  const { snapshot, connected, call } = useRuntime()
  const { colors, styles } = useTheme()
  const lastMessageId = task.messages.at(-1)?.id
  const [revision, setRevision] = useState<{ revision: string; lastMessageId: string }>()
  const action = useAction()
  const work = botWorkSummary(
    task,
    snapshot?.workspace.tasks ?? [],
    snapshot?.workspace.automations ?? [],
    snapshot?.runs ?? [],
  )
  const status = work.failed
    ? `${work.failed} ${uiText('failed')}`
    : work.review
      ? `${work.review} ${uiText('need review')}`
      : work.running
        ? `${work.running} ${uiText('working')}`
        : ''
  const chip = (
    name: IconName,
    label: string,
    count: number | undefined,
    accessibilityLabel: string,
    onPress: () => void,
    disabled = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: 12,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.elevated : colors.surface,
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <Icon name={name} size={16} color={colors.muted} />
      {!!label && <Text style={{ fontSize: 13, fontWeight: '600' }}>{label}</Text>}
      {count !== undefined && (
        <Text
          style={{
            fontSize: 12,
            color: colors.accent,
            fontWeight: '600',
            fontVariant: ['tabular-nums'],
          }}
        >
          {count}
        </Text>
      )}
    </Pressable>
  )
  return (
    <View
      accessibilityLabel={uiText('Bot work overview')}
      style={{ paddingHorizontal: 16, paddingVertical: 6, gap: 4 }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {chip(
          'routines',
          uiText('Routines'),
          work.routines,
          uiText('Routines · {value0}{value1}{value2}{value3}', {
            value0: work.routines,
            value1: work.running ? ` · ${work.running} ${uiText('working')}` : '',
            value2: work.review ? ` · ${work.review} ${uiText('need review')}` : '',
            value3: work.failed ? ` · ${work.failed} ${uiText('failed')}` : '',
          }),
          onRoutines,
        )}
        {chip(
          'agents',
          uiText('Workers'),
          work.workers,
          uiText('Workers · {value0} active{value1}', {
            value0: work.workers,
            value1: work.offlineWorkers ? ` · ${work.offlineWorkers} ${uiText('offline')}` : '',
          }),
          onWorkers,
        )}
        {chip(
          'newChat',
          '',
          undefined,
          uiText('Archive and start new'),
          () => {
            if (task.bot && lastMessageId)
              setRevision({ revision: task.bot.revision, lastMessageId })
          },
          !connected ||
            !snapshot?.botConversationArchiveSupported ||
            !lastMessageId ||
            taskIsWorking(task) ||
            action.busy,
        )}
      </View>
      {(!!status || !connected || !!work.offlineWorkers) && (
        <Text style={[styles.muted, { fontSize: 12 }, work.failed ? styles.error : undefined]}>
          {[
            status,
            work.offlineWorkers ? `${work.offlineWorkers} ${uiText('offline')}` : '',
            !connected ? uiText('Last saved state') : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      )}
      {!!revision && (
        <Sheet
          title={uiText('Archive and start new?')}
          busy={action.busy}
          onClose={() => setRevision(undefined)}
        >
          <Text>
            {uiText(
              'Save this conversation in Side threads and start a fresh conversation. Settings, memory, routines and your unsent draft stay.',
            )}
          </Text>
          <Action
            label={uiText(action.busy ? 'Saving…' : 'Archive and start new')}
            disabled={!connected || action.busy}
            onPress={() =>
              action.act(async () => {
                await call(
                  '/api/bots/archive-conversation',
                  {
                    id: task.id,
                    expectedRevision: revision.revision,
                    expectedLastMessageId: revision.lastMessageId,
                  },
                  botResultSchema,
                )
                setRevision(undefined)
              })
            }
          />
          <Action
            secondary
            label={uiText('Cancel')}
            disabled={action.busy}
            onPress={() => setRevision(undefined)}
          />
          {!!action.error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {action.error}
            </Text>
          )}
        </Sheet>
      )}
    </View>
  )
}
