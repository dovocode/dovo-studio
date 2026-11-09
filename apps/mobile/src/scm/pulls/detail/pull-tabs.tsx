import { Pressable, ScrollView, View } from 'react-native'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
export function PullTabs({
  value,
  items,
  onChange,
}: {
  value: string
  items: Array<{ id: string; name: string }>
  onChange: (id: string) => void
}) {
  const { colors, highContrast } = useTheme()

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, flexShrink: 0 }}
      contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 0 }}
    >
      <View
        accessibilityRole="tablist"
        accessibilityLabel="Pull request tabs"
        style={{
          flexDirection: 'row',
          padding: 3,
          borderRadius: 26,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
        }}
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
              paddingHorizontal: 10,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 22,
              borderWidth: 1,
              borderColor:
                item.id === value ? (highContrast ? colors.text : colors.border) : 'transparent',
              backgroundColor: pressed
                ? colors.elevated
                : item.id === value
                  ? colors.surface
                  : 'transparent',
              shadowColor: '#000',
              shadowOpacity: !highContrast && item.id === value ? 0.1 : 0,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
            })}
          >
            <Text
              style={{
                fontSize: 14,
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
