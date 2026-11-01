import { useEffect, useRef, useMemo, type ComponentProps } from 'react'
import { Alert } from 'react-native'
import { responses, threadPullLink } from '@dovo/protocol'
import {
  useRuntimeSelector,
  sameRuntimeFields,
  type useRuntime,
} from '../../../runtime/connection/provider'
import { Markdown } from '../../../ui/content/markdown'
import { useLinkOrigin } from '../../../ui/content/link-origin'
import { openAppLink } from '../../../ui/content/open-link'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { useConversationSelector, useAppendConversationTemplate } from '../state/provider'

const selectLinkActions = (value: ReturnType<typeof useRuntime>) => ({
  call: value.call,
  connected: value.connected,
})

export function ThreadMarkdown({
  plainText = false,
  ...props
}: Omit<ComponentProps<typeof Markdown>, 'onLinkLongPress' | 'onLinkPress'> & {
  plainText?: boolean
}) {
  const { styles, colors } = useTheme()

  const appendTemplate = useAppendConversationTemplate()
  const taskId = useConversationSelector((value) => value.task.id)
  const origin = useLinkOrigin(taskId)
  const linkActions = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    linkActions.current = controller
    return () => controller.abort()
  }, [taskId, origin.runtimeId])
  const pullRequest = useConversationSelector((value) => value.task.pullRequest)
  const linkedPullRequests = useConversationSelector((value) => value.task.linkedPullRequests)
  const archived = useConversationSelector(
    (value) => !!value.task.archived || !!value.task.archivedAt,
  )
  const { call, connected } = useRuntimeSelector(selectLinkActions, sameRuntimeFields)
  // Keep user text literal. The native Markdown parser drops HTML entities,
  // including the encoded spaces/newlines previously used around PR links.
  const plainParts = useMemo(
    () =>
      props.text
        .split(/(https?:\/\/[^\s<>"'`]+)/gi)
        .flatMap<{ text: string; url?: string }>((part) => {
          const url = part.replace(/[.,;:!?)\]}]+$/, '')
          return threadPullLink(url)
            ? [{ text: url, url }, { text: part.slice(url.length) }]
            : [{ text: part }]
        }),
    [props.text],
  )
  const hasPullLink = plainParts.some((part) => !!part.url)
  const choose = (url: string) => {
    const pull = threadPullLink(url)
    if (!pull) return false
    const linked =
      pullRequest?.url === pull.url || linkedPullRequests?.some((item) => item.url === pull.url)
    void openAppLink(url, false, origin, [
      {
        signal: linkActions.current?.signal,
        label: linked ? 'Already linked to this thread' : 'Link to this thread',
        disabled: !!linked || !connected || archived || (linkedPullRequests?.length ?? 0) >= 20,
        run: () => call('/api/scm/pulls/link-thread', { id: taskId, pulls: [pull] }, responses.ok),
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
      {plainText ? (
        <Text selectable style={styles.chatText}>
          {plainParts.map((part, index) =>
            part.url ? (
              <Text
                key={index}
                accessibilityRole="link"
                style={{ color: colors.accent }}
                onPress={() => {
                  const url = part.url
                  if (url && !choose(url)) open(url)
                }}
                onLongPress={() => {
                  const url = part.url
                  if (url && !choose(url)) open(url)
                }}
              >
                {part.text}
              </Text>
            ) : (
              part.text
            ),
          )}
        </Text>
      ) : (
        <Markdown
          {...props}
          taskId={taskId}
          onUseTemplate={appendTemplate}
          onLinkPress={(url) => {
            if (!choose(url)) open(url)
          }}
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
