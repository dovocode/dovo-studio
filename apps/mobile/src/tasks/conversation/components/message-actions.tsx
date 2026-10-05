import { loadMobileModelCatalog } from '../../../agents/use-model-catalog'
import { useEffect, useMemo, useState } from 'react'
import { AccessibilityInfo, ActionSheetIOS, Alert, Platform, Pressable, View } from 'react-native'
import { Icon } from '../../../ui/controls/icon'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { copyText, shareText } from '../../../ui/content/clipboard'
import {
  modelDisplayName,
  codeBlockLabel,
  fencedCodeBlocks,
  responses,
  shellCommand,
  type CodeBlock,
} from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { useConversationSelector } from '../state/provider'
import { router } from 'expo-router'
import { Schema } from 'effect'
import { modelCatalogSchema, mutableStruct, resolveTaskAgent } from '@dovo/protocol'
import { taskHref } from '../../../shell/task-route'

const forkSchema = mutableStruct({ id: Schema.String })

type Feedback = '' | 'message' | 'code'

/** Copy actions under a message: tap to copy it, touch and hold to share it. Replies with
 * code also offer "Copy code", which asks which block when there are several. */
export function MessageActions({
  text,
  user,
  messageId,
}: {
  text: string
  user: boolean
  messageId?: string
}) {
  const { colors } = useTheme()

  const [feedback, setFeedback] = useState<Feedback>('')
  const blocks = useMemo(() => (user ? [] : fencedCodeBlocks(text)), [text, user])
  const commands = useMemo(
    () =>
      blocks.flatMap((block, index) => {
        const command = shellCommand(block)
        return command ? [{ command, label: codeBlockLabel(block, index) }] : []
      }),
    [blocks],
  )
  const task = useConversationSelector((value) => value.task)
  const setBookmark = useConversationSelector((value) => value.history.setBookmark)
  const openTerminal = useConversationSelector((value) => value.openTerminal)
  const { call, connected, activeId, profile, readRuntime } = useRuntime()
  const bookmarked = task.messages.some((message) => message.id === messageId && message.bookmarked)
  // Fork from a finished agent turn: a new task with the conversation up to here.
  const turn = user ? undefined : task.turns?.find((item) => item.assistantId === messageId)
  const [forking, setForking] = useState(false)
  const { snapshot } = useRuntime()
  const latest = !!turn && task.turns?.at(-1)?.id === turn.id && task.status !== 'running'
  const [retrying, setRetrying] = useState(false)
  const retry = (model?: string) => {
    if (!turn) return
    setRetrying(true)
    void call(
      '/api/tasks/retry',
      { id: task.id, turnId: turn.id, ...(model ? { model } : {}) },
      responses.ok,
    )
      .catch((error: unknown) =>
        Alert.alert('Could not try again', error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setRetrying(false))
  }
  // Same model, or another model of the task's provider (its models load on demand).
  const chooseRetry = () => {
    const agent = resolveTaskAgent(task, snapshot?.workspace.agents ?? [])
    if (!agent || !turn || !profile) return
    const same = `Try again${agent.model ? ` with ${modelDisplayName(agent.model)}` : ''}`
    if (Platform.OS !== 'ios')
      return Alert.alert('Try again?', 'This turn’s file changes are undone first.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Try again', onPress: () => retry() },
      ])
    setRetrying(true)
    void loadMobileModelCatalog(profile, agent, (input) =>
      readRuntime(profile, '/api/agents/models', input, modelCatalogSchema),
    )
      .then((catalog) =>
        catalog.models.filter((model) => !model.hidden && model.id !== agent.model),
      )
      .catch(() => [])
      .then((models) => {
        setRetrying(false)
        const choices = models.slice(0, 8)
        const options = [
          same,
          ...choices.map((model) => modelDisplayName(model.id, model.name)),
          'Cancel',
        ]
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: 'Try again',
            message: 'This turn’s file changes are undone first.',
            options,
            cancelButtonIndex: options.length - 1,
          },
          (index) => {
            if (index === 0) retry()
            else if (choices[index - 1]) retry(choices[index - 1].id)
          },
        )
      })
  }
  const fork = () => {
    if (!turn || forking || !activeId) return
    Alert.alert(
      'Fork from here?',
      'A new task starts with the conversation up to this reply, and this turn’s files in its own worktree.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Fork',
          onPress: () => {
            setForking(true)
            void call('/api/tasks/fork', { id: task.id, turnId: turn.id }, forkSchema)
              .then((result) =>
                router.navigate(taskHref(activeId, result.id), { withAnchor: true }),
              )
              .catch((error: unknown) =>
                Alert.alert(
                  'Could not fork',
                  error instanceof Error ? error.message : String(error),
                ),
              )
              .finally(() => setForking(false))
          },
        },
      ],
    )
  }
  const [running, setRunning] = useState(false)
  // Types the command into the task's terminal on the computer and shows that terminal.
  const runCommand = (command: string) => {
    if (running) return
    setRunning(true)
    void call('/api/terminals/run', { taskId: task.id, command }, responses.terminal)
      .then((terminal) => openTerminal(terminal.id))
      .catch((error: unknown) =>
        Alert.alert(
          'Could not run the command',
          error instanceof Error ? error.message : String(error),
        ),
      )
      .finally(() => setRunning(false))
  }
  const chooseCommand = () => {
    if (commands.length === 1) {
      // Show the command first: it runs on the computer, not on this phone.
      Alert.alert('Run in terminal?', commands[0].command, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Run', onPress: () => runCommand(commands[0].command) },
      ])
      return
    }
    if (Platform.OS === 'ios') {
      const options = [...commands.map((entry) => entry.label), 'Cancel']
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Run in terminal', options, cancelButtonIndex: options.length - 1 },
        (index) => {
          const entry = commands[index]
          if (entry) runCommand(entry.command)
        },
      )
      return
    }
    Alert.alert('Run in terminal', commands.at(-1)?.label ?? '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Run last command', onPress: () => runCommand(commands.at(-1)!.command) },
    ])
  }
  useEffect(() => {
    if (!feedback) return
    const timer = setTimeout(() => setFeedback(''), 1500)
    return () => clearTimeout(timer)
  }, [feedback])
  const copy = (value: string, kind: Exclude<Feedback, ''>) =>
    void copyText(value).then(
      (result) => {
        if (result !== 'copied') return
        setFeedback(kind)
        AccessibilityInfo.announceForAccessibility(kind === 'code' ? 'Code copied' : 'Copied')
      },
      (error: unknown) =>
        Alert.alert('Could not copy', error instanceof Error ? error.message : String(error)),
    )
  const copyCode = () => {
    if (blocks.length === 1) return copy(blocks[0].code, 'code')
    const all = blocks.map((block) => block.code).join('\n\n')
    const choose = (block: CodeBlock | undefined) => block && copy(block.code, 'code')
    if (Platform.OS === 'ios') {
      const options = [...blocks.map(codeBlockLabel), 'All code', 'Cancel']
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Copy code', options, cancelButtonIndex: options.length - 1 },
        (index) => {
          if (index === blocks.length) copy(all, 'code')
          else choose(blocks[index])
        },
      )
      return
    }
    // Android dialogs hold at most three buttons.
    Alert.alert('Copy code', `${blocks.length} code blocks in this reply.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Last block', onPress: () => choose(blocks.at(-1)) },
      { text: 'All code', onPress: () => copy(all, 'code') },
    ])
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <ActionButton
        testID="Copy message"
        label={feedback === 'message' ? 'Copied' : 'Copy message'}
        hint="Touch and hold to share."
        icon={feedback === 'message' ? 'check' : 'copy'}
        onPress={() => copy(text, 'message')}
        onLongPress={() => void shareText(text).catch(() => undefined)}
      />
      {!user && !!messageId && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bookmarked ? 'Remove bookmark' : 'Bookmark reply'}
          accessibilityState={{ selected: bookmarked, disabled: !connected }}
          disabled={!connected}
          onPress={() =>
            void call(
              '/api/tasks/message/bookmark',
              {
                id: task.id,
                messageId,
                bookmarked: !bookmarked,
              },
              responses.ok,
            )
              .then(() => {
                if (messageId) setBookmark(messageId, !bookmarked)
              })
              .catch((error: unknown) => Alert.alert('Could not update bookmark', String(error)))
          }
          style={({ pressed }) => ({
            width: 36,
            height: 32,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed || !connected ? 0.5 : 1,
          })}
        >
          <Icon name="star" size={15} color={bookmarked ? colors.accent : colors.muted} />
        </Pressable>
      )}
      {latest && (
        <Pressable
          testID="Try again"
          accessibilityRole="button"
          accessibilityLabel="Try again"
          accessibilityHint="Runs this request again, with this or another model."
          disabled={!connected || retrying}
          hitSlop={6}
          onPress={chooseRetry}
          style={({ pressed }) => ({
            width: 36,
            height: 32,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed || !connected || retrying ? 0.5 : 1,
          })}
        >
          <Icon name="refresh" size={14} color={colors.muted} />
        </Pressable>
      )}
      {!!turn && turn.status !== 'running' && (
        <Pressable
          testID="Fork from here"
          accessibilityRole="button"
          accessibilityLabel="Fork from here"
          accessibilityHint="Starts a new task with the conversation up to this reply."
          disabled={!connected || forking}
          hitSlop={6}
          onPress={fork}
          style={({ pressed }) => ({
            width: 36,
            height: 32,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed || !connected || forking ? 0.5 : 1,
          })}
        >
          <Icon name="changes" size={14} color={colors.muted} />
        </Pressable>
      )}
      {commands.length > 0 && (
        <Pressable
          testID="Run in terminal"
          accessibilityRole="button"
          accessibilityLabel="Run in terminal"
          accessibilityHint="Runs a command from this reply in the task's terminal on the computer."
          accessibilityState={{ disabled: !connected || running }}
          disabled={!connected || running}
          hitSlop={6}
          onPress={chooseCommand}
          style={({ pressed }) => ({
            height: 32,
            paddingHorizontal: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            opacity: pressed || !connected || running ? 0.5 : 1,
          })}
        >
          <Icon name="terminal" size={13} color={colors.muted} />
          <Text style={{ color: colors.muted, fontSize: 12 }}>Run</Text>
        </Pressable>
      )}
      {blocks.length > 0 && (
        <Pressable
          testID="Copy code"
          accessibilityRole="button"
          accessibilityLabel={feedback === 'code' ? 'Code copied' : 'Copy code'}
          hitSlop={6}
          onPress={copyCode}
          style={({ pressed }) => ({
            height: 32,
            paddingHorizontal: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Icon name={feedback === 'code' ? 'check' : 'copy'} size={13} color={colors.muted} />
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {feedback === 'code' ? 'Copied' : 'Copy code'}
          </Text>
        </Pressable>
      )}
    </View>
  )
}

function ActionButton(props: {
  testID: string
  label: string
  hint: string
  icon: 'copy' | 'check'
  onPress: () => void
  onLongPress: () => void
}) {
  const { colors } = useTheme()

  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityHint={props.hint}
      hitSlop={6}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      style={({ pressed }) => ({
        width: 36,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.5 : 1,
      })}
    >
      <Icon
        name={props.icon}
        size={14}
        color={props.icon === 'check' ? colors.success : colors.muted}
      />
    </Pressable>
  )
}
