import { useMemo } from 'react'
import {
  messageReferences,
  resolveScopedAgents,
  taskResources,
  threadPullLink,
} from '@dovo/protocol'
import {
  useRuntimeSelector,
  sameRuntimeFields,
  type useRuntime,
} from '../../../runtime/connection/provider'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { useConversationSelector } from '../state/provider'
import {
  NativeReferenceMessage,
  nativeReferenceMessagesAvailable,
} from '../../composer/native-composer-input'

const selectResources = (value: ReturnType<typeof useRuntime>) => ({
  agents: value.snapshot?.workspace.agents,
  repositories: value.snapshot?.workspace.repositories,
  defaults: value.snapshot?.defaults,
})

export function UserMessageText({ text, onLink }: { text: string; onLink: (url: string) => void }) {
  const { styles, colors } = useTheme()
  const id = useConversationSelector((value) => value.task.id)
  const bot = useConversationSelector((value) => value.task.bot)
  const repositoryId = useConversationSelector((value) =>
    value.task.bot ? '' : value.task.repositoryId,
  )
  const agentId = useConversationSelector((value) => value.task.agentId)
  const agentOverrides = useConversationSelector((value) => value.task.agentOverrides)
  const harness = useConversationSelector((value) => value.task.harness)
  const { agents, repositories, defaults } = useRuntimeSelector(selectResources, sameRuntimeFields)
  const resources = useMemo(
    () => ({
      ...taskResources(
        { id, repositoryId, agentId, agentOverrides, harness, bot },
        { agents: agents ?? [], repositories: repositories ?? [] },
        defaults,
      ),
      agents: resolveScopedAgents(
        defaults,
        repositories?.find((repository) => repository.id === repositoryId),
        agents ?? [],
      ),
    }),
    [id, repositoryId, agentId, agentOverrides, harness, bot, agents, repositories, defaults],
  )
  const references = useMemo(() => messageReferences(text, resources), [text, resources])
  const parts = useMemo(() => {
    const parts: { text: string; url?: string }[] = []
    const appendText = (value: string) => {
      for (const part of value.split(/(https?:\/\/[^\s<>"'`]+)/gi)) {
        const url = part.replace(/[.,;:!?)\]}]+$/, '')
        if (threadPullLink(url)) parts.push({ text: url, url }, { text: part.slice(url.length) })
        else parts.push({ text: part })
      }
    }
    let offset = 0
    for (const reference of references) {
      appendText(text.slice(offset, reference.start))
      parts.push({ text: text.slice(reference.start, reference.end) })
      offset = reference.end
    }
    appendText(text.slice(offset))
    return parts
  }, [text, references])
  const links = useMemo(() => {
    let offset = 0
    return parts.flatMap((part) => {
      const start = offset
      offset += part.text.length
      return part.url ? [{ start, end: offset, url: part.url }] : []
    })
  }, [parts])
  if (nativeReferenceMessagesAvailable && references.length)
    return (
      <NativeReferenceMessage text={text} references={references} links={links} onLink={onLink} />
    )
  return (
    <Text selectable style={styles.chatText}>
      {parts.map((part, index) => {
        const url = part.url
        return url ? (
          <Text
            key={index}
            accessibilityRole="link"
            style={{ color: colors.accent }}
            onPress={() => onLink(url)}
            onLongPress={() => onLink(url)}
          >
            {part.text}
          </Text>
        ) : (
          part.text
        )
      })}
    </Text>
  )
}
