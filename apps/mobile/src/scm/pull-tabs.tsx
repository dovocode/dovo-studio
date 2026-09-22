import { Pressable, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { colors } from '../ui/theme'
export function PullTabs({
  value,
  items,
  onChange,
}: {
  value: string
  items: Array<{ id: string; name: string }>
  onChange: (id: string) => void
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 4 }}
    >
      <View
        style={{ flexDirection: 'row', padding: 2, borderRadius: 12, backgroundColor: '#ffffff08' }}
      >
        {items.map((item) => (
          <Pressable
            key={item.id}
            testID={`PR ${item.id}`}
            accessibilityRole="tab"
            accessibilityLabel={item.name}
            accessibilityState={{ selected: item.id === value }}
            onPress={() => onChange(item.id)}
            style={({ pressed }) => ({
              paddingHorizontal: 14,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 10,
              backgroundColor: pressed
                ? '#ffffff30'
                : item.id === value
                  ? '#ffffff20'
                  : 'transparent',
            })}
          >
            <Text
              style={{
                fontSize: 15,
                fontWeight: '600',
                color: item.id === value ? colors.text : colors.muted,
              }}
            >
              {item.name}
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  )
}
