import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { responseReply } from '@dovo/protocol'
import {
  botResultSchema,
  forkFileDescription,
  forkMessagePreview,
  messageForkBlocker,
  randomUUID,
  resolveTaskDefaults,
  taskForkResultSchema,
  taskIsWorking,
  threadForkBlocker,
  turnForkResultSchema,
} from '@dovo/protocol'
import { loadMobileModelCatalog } from '../../../agents/use-model-catalog'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, ActionSheetIOS, Alert, Platform, Pressable, View } from 'react-native'
import { Icon } from '../../../ui/controls/icon'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { copyText, shareText } from '../../../ui/content/clipboard'
import {
  modelDisplayName,
  codeBlockLabel,
  fencedCodeBlocks,
  isImageAttachment,
  responses,
  shellCommand,
  type CodeBlock,
} from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import {
  useAppendConversationTemplate,
  useConversationPresentation,
  useConversationSelector,
  usePendingConversationMessage,
} from '../state/provider'
import { router } from 'expo-router'
import { modelCatalogSchema, resolveTaskAgent } from '@dovo/protocol'
import { taskHref } from '../../../shell/task-route'
import { QuoteSelection } from './quote-selection'
import { SuggestRoutine } from './suggest-routine'
import { requestMessageReveal } from '../message-reveal'

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
  const uiText = useInterfaceText()

  const { colors } = useTheme()

  const [feedback, setFeedback] = useState<Feedback>('')
  const [quoting, setQuoting] = useState(false)
  const blocks = useMemo(() => (user ? [] : fencedCodeBlocks(text)), [text, user])
  const commands = useMemo(
    () =>
      blocks.flatMap((block, index) => {
        const command = shellCommand(block)
        return command ? [{ command, label: codeBlockLabel(block, index) }] : []
      }),
    [blocks],
  )
  const appendReply = useAppendConversationTemplate()
  const task = useConversationSelector((value) => value.task)
  const setBookmark = useConversationSelector((value) => value.history.setBookmark)
  const openTerminal = useConversationSelector((value) => value.openTerminal)
  const { call, connected, activeId, profile, readRuntime, snapshot } = useRuntime()
  const bookmarked = task.messages.some((message) => message.id === messageId && message.bookmarked)
  // Fork from a finished agent turn: a new task with the conversation up to here.
  const turn = user ? undefined : task.turns?.find((item) => item.assistantId === messageId)
  const [forking, setForking] = useState(false)
  const snapshotTree = turn?.checkpoint?.after
  const turnForkLabel = snapshotTree
    ? uiText('Fork with files from this turn')
    : uiText('Fork from this reply')
  const project = snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)
  const latest = !!turn && task.turns?.at(-1)?.id === turn.id && task.status !== 'running'
  // Runtimes with message forks also offer settled user and assistant messages.
  const messageForks = snapshot?.messageForkSupported === true
  const presentation = useConversationPresentation(messageId ?? '')
  const pending = usePendingConversationMessage(messageId ?? '')
  const message = messageId ? task.messages.find((item) => item.id === messageId) : undefined
  const forkable =
    messageForks &&
    !task.bot &&
    !!message &&
    !pending &&
    !messageForkBlocker(message, presentation?.status ?? 'completed', task.status === 'running')
  // One ID per fork attempt, so a retry after a lost reply returns the same thread.
  const forkId = useRef<string | undefined>(undefined)
  const [retrying, setRetrying] = useState(false)
  const retry = (model?: string) => {
    if (!turn || !snapshot?.retryUsesCurrentFiles) return
    setRetrying(true)
    void call(
      '/api/tasks/retry',
      { id: task.id, turnId: turn.id, ...(model ? { model } : {}) },
      responses.ok,
    )
      .catch((error: unknown) =>
        Alert.alert(
          uiText('Could not try again'),
          error instanceof Error ? error.message : String(error),
        ),
      )
      .finally(() => setRetrying(false))
  }
  // Same model, or another model of the task's provider (its models load on demand).
  const chooseRetry = () => {
    const agent = resolveTaskAgent(task, snapshot?.workspace.agents ?? [])
    if (!agent || !turn || !profile) return
    const same = `Try again${agent.model ? ` with ${modelDisplayName(agent.model)}` : ''}`
    if (!snapshot?.retryUsesCurrentFiles)
      return Alert.alert(
        uiText('Try again'),
        uiText('Update the computer to retry using the current files.'),
      )
    const message = uiText('The next turn uses the current files.')
    if (Platform.OS !== 'ios')
      return Alert.alert(uiText('Try again?'), message, [
        { text: uiText('Cancel'), style: 'cancel' },
        { text: uiText('Try again'), onPress: () => retry() },
      ])
    setRetrying(true)
    void loadMobileModelCatalog(
      profile,
      agent,
      (input) => readRuntime(profile, '/api/agents/models', input, modelCatalogSchema),
      false,
      snapshot,
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
            title: uiText('Try again'),
            message,
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
  const openFork = (id: string, anchor: string | undefined) => {
    if (!activeId) return
    if (anchor && profile) requestMessageReveal(profile.connection, id, anchor)
    router.navigate(taskHref(activeId, id, undefined, undefined, snapshot?.runtimeId), {
      withAnchor: true,
    })
  }
  const fork = () => {
    if (!turn || forking || !activeId || task.bot) return
    const files = uiText(forkFileDescription(task.execution, project?.kind, snapshotTree))
    const preview = forkMessagePreview({ text, attachments: message?.attachments })
    Alert.alert(
      snapshotTree ? uiText('Fork with files from this turn?') : uiText('Fork from this reply?'),
      [
        uiText('The new thread includes the conversation up to and including this reply.'),
        uiText('Selected reply: {value0}', { value0: preview || uiText('(No reply text)') }),
        [snapshotTree ? '' : uiText('This turn has no saved file snapshot.'), files]
          .filter(Boolean)
          .join(' '),
      ].join('\n\n'),
      [
        { text: uiText('Cancel'), style: 'cancel' },
        {
          text: uiText('Fork'),
          onPress: () => {
            setForking(true)
            void call('/api/tasks/fork', { id: task.id, turnId: turn.id }, turnForkResultSchema)
              .then((result) => openFork(result.id, result.messageId))
              .catch((error: unknown) =>
                Alert.alert(
                  uiText('Could not fork'),
                  error instanceof Error ? error.message : String(error),
                ),
              )
              .finally(() => setForking(false))
          },
        },
      ],
    )
  }
  const forkMessage = () => {
    if (!message || forking || !activeId) return
    const blocker = threadForkBlocker(task)
    if (blocker) return Alert.alert(uiText('Could not fork'), blocker)
    const defaults = resolveTaskDefaults(snapshot?.defaults, project)
    const preview = forkMessagePreview(message) || uiText('(No message text)')
    Alert.alert(
      uiText('Fork conversation?'),
      [
        uiText(
          'The new thread includes the conversation up to and including this message. It uses this thread’s harness, model and access.',
        ),
        message.role === 'assistant'
          ? uiText('Selected reply: {value0}', { value0: preview })
          : uiText('Selected message: {value0}', { value0: preview }),
        `${uiText('Files are not rewound.')} ${uiText(forkFileDescription(defaults.execution, project?.kind))}`,
      ].join('\n\n'),
      [
        { text: uiText('Cancel'), style: 'cancel' },
        {
          text: uiText('Fork'),
          onPress: () => {
            setForking(true)
            void call(
              '/api/tasks/fork-message',
              { id: task.id, messageId: message.id, forkId: (forkId.current ??= randomUUID()) },
              taskForkResultSchema,
            )
              .then((result) => {
                forkId.current = undefined
                openFork(result.id, message.id)
              })
              .catch((error: unknown) =>
                Alert.alert(
                  uiText('Could not fork'),
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
          uiText('Could not run the command'),
          error instanceof Error ? error.message : String(error),
        ),
      )
      .finally(() => setRunning(false))
  }
  const chooseCommand = () => {
    if (commands.length === 1) {
      // Show the command first: it runs on the computer, not on this phone.
      Alert.alert(uiText('Run in terminal?'), commands[0].command, [
        { text: uiText('Cancel'), style: 'cancel' },
        { text: uiText('Run'), onPress: () => runCommand(commands[0].command) },
      ])
      return
    }
    if (Platform.OS === 'ios') {
      const options = [...commands.map((entry) => entry.label), 'Cancel']
      ActionSheetIOS.showActionSheetWithOptions(
        { title: uiText('Run in terminal'), options, cancelButtonIndex: options.length - 1 },
        (index) => {
          const entry = commands[index]
          if (entry) runCommand(entry.command)
        },
      )
      return
    }
    Alert.alert(uiText('Run in terminal'), commands.at(-1)?.label ?? '', [
      { text: uiText('Cancel'), style: 'cancel' },
      { text: uiText('Run last command'), onPress: () => runCommand(commands.at(-1)!.command) },
    ])
  }
  useEffect(() => {
    if (!feedback) return
    const timer = setTimeout(() => setFeedback(''), 1500)
    return () => clearTimeout(timer)
  }, [feedback])
  const copy = (value: string, kind: Exclude<Feedback, ''>) =>
    void copyText(
      value,
      kind === 'message' && snapshot?.runtimeId && message?.attachments
        ? {
            runtimeId: snapshot.runtimeId,
            taskId: task.id,
            ids: message.attachments.filter(isImageAttachment).map(({ id }) => id),
          }
        : undefined,
    ).then(
      (result) => {
        if (result !== 'copied') return
        setFeedback(kind)
        AccessibilityInfo.announceForAccessibility(kind === 'code' ? 'Code copied' : 'Copied')
      },
      (error: unknown) =>
        Alert.alert(
          uiText('Could not copy'),
          error instanceof Error ? error.message : String(error),
        ),
    )
  const copyCode = () => {
    if (blocks.length === 1) return copy(blocks[0].code, 'code')
    const all = blocks.map((block) => block.code).join('\n\n')
    const choose = (block: CodeBlock | undefined) => block && copy(block.code, 'code')
    if (Platform.OS === 'ios') {
      const options = [...blocks.map(codeBlockLabel), 'All code', 'Cancel']
      ActionSheetIOS.showActionSheetWithOptions(
        { title: uiText('Copy code'), options, cancelButtonIndex: options.length - 1 },
        (index) => {
          if (index === blocks.length) copy(all, 'code')
          else choose(blocks[index])
        },
      )
      return
    }
    // Android dialogs hold at most three buttons.
    Alert.alert(
      uiText('Copy code'),
      uiText('{value0} code blocks in this reply.', { value0: blocks.length }),
      [
        { text: uiText('Cancel'), style: 'cancel' },
        { text: uiText('Last block'), onPress: () => choose(blocks.at(-1)) },
        { text: uiText('All code'), onPress: () => copy(all, 'code') },
      ],
    )
  }
  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap', maxWidth: '100%', alignItems: 'center' }}
    >
      <ActionButton
        testID="Copy message"
        label={feedback === 'message' ? uiText('Copied') : uiText('Copy message')}
        hint={uiText('Touch and hold to share.')}
        icon={feedback === 'message' ? 'check' : 'copy'}
        onPress={() => copy(text, 'message')}
        onLongPress={() => void shareText(text).catch(() => undefined)}
      />
      {!user && !!messageId && !!text && (
        <ActionButton
          testID="Reply to response"
          hint={uiText('Adds a quote to your draft.')}
          label={uiText('Reply to response')}
          icon="chat"
          onPress={() => {
            appendReply(responseReply({ id: messageId, text }))
          }}
        />
      )}
      {!user && !!messageId && !!text && (
        <>
          <ActionButton
            testID="Quote selection"
            label={uiText('Quote selection')}
            hint={uiText('Select the part of this response to add to your draft.')}
            icon="chat"
            onPress={() => setQuoting(true)}
          />
          {quoting && (
            <QuoteSelection
              text={text}
              messageId={messageId}
              taskId={task.id}
              onQuote={appendReply}
              onClose={() => setQuoting(false)}
            />
          )}
        </>
      )}
      {!user && !!messageId && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bookmarked ? uiText('Remove bookmark') : uiText('Bookmark reply')}
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
              .catch((error: unknown) =>
                Alert.alert(uiText('Could not update bookmark'), String(error)),
              )
          }
          style={({ pressed }) => ({
            width: 44,
            minHeight: 44,
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
          accessibilityLabel={uiText('Try again')}
          accessibilityHint={uiText('Runs this request again, with this or another model.')}
          accessibilityState={{ disabled: !connected || retrying, busy: retrying }}
          disabled={!connected || retrying}
          onPress={chooseRetry}
          style={({ pressed }) => ({
            width: 44,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed || !connected || retrying ? 0.5 : 1,
          })}
        >
          <Icon name="refresh" size={14} color={colors.muted} />
        </Pressable>
      )}
      {forkable && (
        <Pressable
          testID="Fork conversation"
          accessibilityRole="button"
          accessibilityLabel={uiText('Fork conversation')}
          accessibilityHint={uiText(
            'Starts a new thread with the conversation up to this message. Files are not rewound.',
          )}
          accessibilityState={{ disabled: !connected || forking, busy: forking }}
          disabled={!connected || forking}
          onPress={forkMessage}
          style={({ pressed }) => ({
            width: 44,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed || !connected || forking ? 0.5 : 1,
          })}
        >
          <Icon name="newChat" size={14} color={colors.muted} />
        </Pressable>
      )}
      {user && message && !pending && <SuggestRoutine taskId={task.id} message={message} />}
      {!!turn && !task.bot && turn.status !== 'running' && (
        <Pressable
          testID={snapshotTree ? 'Fork with files from this turn' : 'Fork from this reply'}
          accessibilityRole="button"
          accessibilityLabel={turnForkLabel}
          accessibilityHint={uiText('Shows the conversation and files that the fork will use.')}
          accessibilityState={{ disabled: !connected || forking, busy: forking }}
          disabled={!connected || forking}
          onPress={fork}
          style={({ pressed }) => ({
            width: 44,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed || !connected || forking ? 0.5 : 1,
          })}
        >
          <Icon name="changes" size={14} color={colors.muted} />
        </Pressable>
      )}
      {!!turn && task.bot && turn.status !== 'running' && (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText('Reset context to here')}
            disabled={
              !connected ||
              forking ||
              !snapshot?.botContextResetSupported ||
              taskIsWorking(task) ||
              !!task.queue?.length
            }
            onPress={() =>
              Alert.alert(
                uiText('Reset Bot context to this reply?'),
                uiText(
                  'Future replies will use the conversation up to this point. Later messages stay visible for reference. Files and completed actions stay unchanged.',
                ),
                [
                  { text: uiText('Cancel'), style: 'cancel' },
                  {
                    text: uiText('Reset context'),
                    onPress: () => {
                      if (!task.bot || forking) return
                      setForking(true)
                      void call(
                        '/api/bots/reset-context',
                        { id: task.id, turnId: turn.id, expectedRevision: task.bot.revision },
                        botResultSchema,
                      )
                        .catch((error: unknown) =>
                          Alert.alert(
                            uiText('Could not reset context'),
                            error instanceof Error ? error.message : String(error),
                          ),
                        )
                        .finally(() => setForking(false))
                    },
                  },
                ],
              )
            }
            style={{ width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="refresh" size={14} color={colors.muted} />
          </Pressable>
          {task.bot.contextResets?.some((reset) => reset.turnId === turn.id) && (
            <Text>
              <InterfaceText>{'Context reset here'}</InterfaceText>
            </Text>
          )}
        </View>
      )}
      {commands.length > 0 && (
        <Pressable
          testID="Run in terminal"
          accessibilityRole="button"
          accessibilityLabel={uiText('Run in terminal')}
          accessibilityHint={uiText(
            "Runs a command from this reply in the task's terminal on the computer.",
          )}
          accessibilityState={{ disabled: !connected || running }}
          disabled={!connected || running}
          onPress={chooseCommand}
          style={({ pressed }) => ({
            minHeight: 44,
            minWidth: 44,
            paddingHorizontal: 8,
            paddingVertical: 6,
            maxWidth: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            opacity: pressed || !connected || running ? 0.5 : 1,
          })}
        >
          <Icon name="terminal" size={13} color={colors.muted} />
          <Text style={{ color: colors.muted, fontSize: 12, flexShrink: 1 }}>
            <InterfaceText>{'Run'}</InterfaceText>
          </Text>
        </Pressable>
      )}
      {blocks.length > 0 && (
        <Pressable
          testID="Copy code"
          accessibilityRole="button"
          accessibilityLabel={feedback === 'code' ? uiText('Code copied') : uiText('Copy code')}
          onPress={copyCode}
          style={({ pressed }) => ({
            minHeight: 44,
            minWidth: 44,
            paddingHorizontal: 8,
            paddingVertical: 6,
            maxWidth: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Icon name={feedback === 'code' ? 'check' : 'copy'} size={13} color={colors.muted} />
          <Text style={{ color: colors.muted, fontSize: 12, flexShrink: 1 }}>
            {feedback === 'code' ? uiText('Copied') : uiText('Copy code')}
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
  icon: 'copy' | 'check' | 'chat'
  onPress: () => void
  onLongPress?: () => void
}) {
  const { colors } = useTheme()

  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityHint={props.hint}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      style={({ pressed }) => ({
        width: 44,
        minHeight: 44,
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
