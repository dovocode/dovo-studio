import { HStack, Link, Text, VStack } from '@expo/ui/swift-ui'
import { font, foregroundStyle, lineLimit, widgetURL } from '@expo/ui/swift-ui/modifiers'
import { createWidget, type WidgetEnvironment } from 'expo-widgets'

type Item = { title: string; status: string; url: string }
type Props = { running: number; waiting: number; items: Item[] }
export default createWidget('DovoTasks', (props: Props, environment: WidgetEnvironment) => {
  'widget'
  const small = environment.widgetFamily === 'systemSmall'
  const rows = props.items.slice(0, small ? 1 : environment.widgetFamily === 'systemLarge' ? 5 : 2)
  return (
    <VStack
      alignment="leading"
      spacing={7}
      modifiers={[widgetURL(rows[0]?.url ?? 'dovo://'), foregroundStyle('#f5f5f5')]}
    >
      <Text modifiers={[font({ weight: 'bold', size: 15 })]}>Dovo</Text>
      <HStack spacing={9}>
        <Text modifiers={[font({ size: 12 })]}>{props.running} working</Text>
        <Text modifiers={[font({ size: 12 })]}>{props.waiting} waiting</Text>
      </HStack>
      {rows.map((item) => (
        <Link key={item.url} destination={item.url}>
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[font({ weight: 'semibold', size: 13 }), lineLimit(1)]}>
              {item.title}
            </Text>
            <Text modifiers={[font({ size: 11 }), foregroundStyle('#a3a3a3')]}>{item.status}</Text>
          </VStack>
        </Link>
      ))}
      {!rows.length && <Text modifiers={[font({ size: 12 })]}>No active tasks</Text>}
    </VStack>
  )
})
