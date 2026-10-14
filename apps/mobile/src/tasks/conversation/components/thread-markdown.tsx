import { useMemo, useRef, useState, type ComponentProps } from 'react'
import { Alert, View } from 'react-native'
import { responses, threadPullLink } from '@dovo/protocol'
import { Effect } from 'effect'
import { useRuntime } from '../../../runtime/connection/provider'
import { useAction } from '../../../ui/controls/use-action'
import { Action } from '../../../ui/controls/action'
import { Markdown } from '../../../ui/content/markdown'
import { useLinkOrigin } from '../../../ui/content/link-origin'
import { openAppLink } from '../../../ui/content/open-link'
import { Text } from '../../../ui/content/text'
import { Sheet, type SheetHandle } from '../../../ui/layout/sheet'
import { useTheme } from '../../../ui/theme'
import { useConversationSelector } from '../state/provider'

// Encode Markdown syntax and whitespace so a user message stays literal, while PR URLs
// use native links whose long-press gesture can coexist with text selection.
function plainMessageMarkdown(text: string) {
  const literal = (value: string) =>
    value.replace(/[\\&<>`*_[\]{}()#+.!|~\s-]/g, (char) => `&#${char.charCodeAt(0)};`)
  return text
    .split(/(https?:\/\/[^\s<>"'`]+)/gi)
    .map((part) => {
      const url = part.replace(/[.,;:!?)\]}]+$/, '')
      return threadPullLink(url)
        ? `[${literal(url)}](<${url}>)${literal(part.slice(url.length))}`
        : literal(part)
    })
    .join('')
}

export function ThreadMarkdown({
  plainText = false,
  ...props
}: Omit<ComponentProps<typeof Markdown>, 'onLinkLongPress'> & {
  plainText?: boolean
}) {
  const { styles } = useTheme()

  const draft = useConversationSelector((value) => value.actions.draft)
  const taskId = useConversationSelector((value) => value.task.id)
  const origin = useLinkOrigin(taskId)
  const scope = useConversationSelector((value) => value.actions.threadScope)
  const hasPullLink = useMemo(
    () =>
      [...props.text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)].some((match) =>
        threadPullLink(match[0].replace(/[.,;:!?)\]}]+$/, '')),
      ),
    [props.text],
  )
  const [selected, setSelected] = useState<{ scope: string; url: string } | null>(null)
  const markdown = useMemo(
    () => (plainText && hasPullLink ? plainMessageMarkdown(props.text) : props.text),
    [plainText, hasPullLink, props.text],
  )
  const pull = selected?.scope === scope ? threadPullLink(selected.url) : null
  const choose = (url: string) => {
    if (!threadPullLink(url)) return false
    setSelected({ scope, url })
    return true
  }
  const open = (url: string) => {
    void openAppLink(url, false, origin).catch((cause: unknown) => {
      Alert.alert('Could not open link', String(cause))
    })
  }
  return (
    <>
      {plainText && !hasPullLink ? (
        <Text selectable style={styles.chatText}>
          {props.text}
        </Text>
      ) : (
        <Markdown
          {...props}
          taskId={taskId}
          onUseTemplate={(prompt) =>
            draft.update([draft.text.trimEnd(), prompt].filter(Boolean).join('\n\n'))
          }
          text={markdown}
          variant={plainText ? 'chat' : props.variant}
          onLinkLongPress={
            hasPullLink
              ? (url) => {
                  if (!choose(url)) open(url)
                }
              : undefined
          }
        />
      )}
      {pull && (
        <ThreadPullActions
          key={`${scope}:${pull.url}`}
          pull={pull}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}

function ThreadPullActions({
  pull,
  onClose,
}: {
  pull: NonNullable<ReturnType<typeof threadPullLink>>
  onClose: () => void
}) {
  const { styles } = useTheme()

  const task = useConversationSelector((value) => value.task)
  const origin = useLinkOrigin(task.id)
  const sheet = useRef<SheetHandle>(null)
  const { connected, callEffect } = useRuntime()
  const action = useAction()
  const linked =
    task.pullRequest?.url === pull.url ||
    task.linkedPullRequests?.some((item) => item.url === pull.url)
  const unavailable =
    !connected ||
    !!task.archived ||
    !!task.archivedAt ||
    (task.linkedPullRequests?.length ?? 0) >= 20
  return (
    <Sheet
      ref={sheet}
      title={`Pull request #${pull.number}`}
      busy={action.busy}
      onClose={() => {
        if (!action.busy) onClose()
      }}
    >
      <View style={{ gap: 12 }}>
        <Text style={styles.muted}>{pull.url}</Text>
        <Action
          label={
            action.busy
              ? 'Linking…'
              : linked
                ? 'Already linked to this thread'
                : 'Link to this thread'
          }
          disabled={action.busy || linked || unavailable}
          onPress={() => {
            if (action.busy || linked || unavailable) return
            action.act(() =>
              callEffect(
                '/api/scm/pulls/link-thread',
                { id: task.id, pulls: [pull] },
                responses.ok,
              ).pipe(Effect.tap(() => Effect.sync(onClose))),
            )
          }}
        />
        <Action
          label="Open PR"
          secondary
          disabled={action.busy}
          onPress={() =>
            action.act(async () => {
              sheet.current?.dismiss(() => {
                void openAppLink(pull.url, false, origin).catch((error: unknown) =>
                  Alert.alert('Could not open link', String(error)),
                )
              })
            })
          }
        />
        {!connected && (
          <Text style={styles.muted}>Connect to the thread’s computer to link this PR.</Text>
        )}
        {(task.archived || task.archivedAt) && (
          <Text style={styles.muted}>Reopen this thread to link this PR.</Text>
        )}
        {!linked && (task.linkedPullRequests?.length ?? 0) >= 20 && (
          <Text style={styles.muted}>A thread can link at most 20 pull requests.</Text>
        )}
        {!!action.error && <Text style={styles.error}>{action.error}</Text>}
      </View>
    </Sheet>
  )
}
