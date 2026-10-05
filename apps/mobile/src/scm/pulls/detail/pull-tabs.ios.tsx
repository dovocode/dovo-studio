import { useTheme } from '../../../ui/theme'
import { Host, Picker, Text } from '@expo/ui/swift-ui'
import { controlSize, frame, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers'
import { View } from 'react-native'

export function PullTabs({
  value,
  items,
  onChange,
}: {
  value: string
  items: Array<{ id: string; name: string }>
  onChange: (id: string) => void
}) {
  const { mode: appearanceMode } = useTheme()

  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
      <Host
        ignoreSafeArea="all"
        matchContents={{ vertical: true }}
        colorScheme={appearanceMode}
        style={{ width: '100%' }}
      >
        <Picker
          label="Pull request view"
          selection={value}
          onSelectionChange={onChange}
          modifiers={[pickerStyle('segmented'), controlSize('regular'), frame({ minHeight: 44 })]}
        >
          {items.map((item) => (
            <Text key={item.id} testID={`PR ${item.id}`} modifiers={[tag(item.id)]}>
              {item.name}
            </Text>
          ))}
        </Picker>
      </Host>
    </View>
  )
}
