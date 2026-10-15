import { useEffect, useRef, useMemo, type ComponentProps } from 'react'
import { Alert } from 'react-native'
import { responses, threadPullLink } from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { Markdown } from '../../../ui/content/markdown'
import { useLinkOrigin } from '../../../ui/content/link-origin'
import { openAppLink } from '../../../ui/content/open-link'
import { Text } from '../../../ui/content/text'
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
  const linkActions = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    linkActions.current = controller
    return () => controller.abort()
  }, [taskId, origin.runtimeId])
  const task = useConversationSelector((value) => value.task)
  const { call, connected } = useRuntime()
  const hasPullLink = useMemo(
    () =>
      [...props.text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)].some((match) =>
        threadPullLink(match[0].replace(/[.,;:!?)\]}]+$/, '')),
      ),
    [props.text],
  )
  const markdown = useMemo(
    () => (plainText && hasPullLink ? plainMessageMarkdown(props.text) : props.text),
    [plainText, hasPullLink, props.text],
  )
  const choose = (url: string) => {
    const pull = threadPullLink(url)
    if (!pull) return false
    const linked =
      task.pullRequest?.url === pull.url ||
      task.linkedPullRequests?.some((item) => item.url === pull.url)
    void openAppLink(url, false, origin, [
      {
        signal: linkActions.current?.signal,
        label: linked ? 'Already linked to this thread' : 'Link to this thread',
        disabled:
          !!linked ||
          !connected ||
          !!task.archived ||
          !!task.archivedAt ||
          (task.linkedPullRequests?.length ?? 0) >= 20,
        run: () => call('/api/scm/pulls/link-thread', { id: task.id, pulls: [pull] }, responses.ok),
      },
    ]).catch((cause: unknown) => Alert.alert('Could not open link', String(cause)))
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
    </>
  )
}
