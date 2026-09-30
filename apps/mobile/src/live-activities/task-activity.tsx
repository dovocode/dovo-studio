import { Image, Text, VStack, HStack, Spacer } from '@expo/ui/swift-ui'
import { font, foregroundStyle, padding, lineLimit } from '@expo/ui/swift-ui/modifiers'
import { createLiveActivity } from 'expo-widgets'
import type { LiveTaskProps } from '@dovo/protocol'

export default createLiveActivity('DovoTask', (props: LiveTaskProps) => {
  'widget'
  const working = props.status === 'Working'
  const symbol =
    props.status === 'Needs input'
      ? 'bubble.left.and.exclamationmark.bubble.right'
      : working
        ? 'terminal'
        : props.status === 'Done'
          ? 'checkmark.circle'
          : 'exclamationmark.circle'
  const detail = (
    <VStack alignment="leading" spacing={5} modifiers={[padding({ all: 14 })]}>
      <HStack>
        <Image systemName={symbol} />
        <Text modifiers={[font({ weight: 'semibold', size: 13 })]}>{props.status}</Text>
        {(props.activeThreads ?? 0) > 1 && (working || props.status === 'Needs input') && (
          <Text modifiers={[font({ size: 11 }), foregroundStyle('#a3a3a3')]}>
            {props.activeThreads} active threads
          </Text>
        )}
        <Spacer />
        {working && props.startedAt > 0 && (
          <Text
            date={new Date(props.startedAt)}
            dateStyle="timer"
            modifiers={[font({ size: 13 })]}
          />
        )}
      </HStack>
      <Text modifiers={[font({ weight: 'semibold', size: 15 }), lineLimit(2)]}>{props.title}</Text>
      <Text modifiers={[font({ size: 13 }), lineLimit(2)]}>
        {props.activity || (working ? 'Agent is working' : props.status)}
      </Text>
      {(props.queued ?? 0) > 0 && (
        <HStack spacing={4}>
          <Image systemName="tray.full" />
          <Text modifiers={[font({ size: 11 })]}>{props.queued} queued</Text>
        </HStack>
      )}
      <Text modifiers={[font({ size: 12 }), foregroundStyle('#a3a3a3'), lineLimit(1)]}>
        {props.project ? `${props.project} · ${props.device}` : props.device}
      </Text>
    </VStack>
  )
  return {
    banner: detail,
    compactLeading: <Image systemName={symbol} />,
    compactTrailing: (
      <Text modifiers={[font({ size: 12 })]}>
        {props.status === 'Needs input'
          ? 'Input'
          : working
            ? `${props.activeThreads ?? 1} active`
            : props.status}
      </Text>
    ),
    minimal: <Image systemName={symbol} />,
    expandedBottom: detail,
  }
})
