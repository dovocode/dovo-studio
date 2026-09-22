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
      <Text modifiers={[font({ size: 12 }), foregroundStyle('#a3a3a3'), lineLimit(1)]}>
        {props.project} · {props.device}
      </Text>
    </VStack>
  )
  return {
    banner: detail,
    compactLeading: <Image systemName={symbol} />,
    compactTrailing: (
      <Text modifiers={[font({ size: 12 })]}>
        {working ? 'Dovo' : props.status === 'Needs input' ? 'Input' : props.status}
      </Text>
    ),
    minimal: <Image systemName={symbol} />,
    expandedBottom: detail,
  }
})
