import { Modal, Platform, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from '../ui/controls/icon'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import type { WorkbenchTab } from './route-paths'

export function MoreMenu({
  active,
  artifactsEnabled,
  car,
  onSelect,
  onClose,
}: {
  active: WorkbenchTab
  artifactsEnabled: boolean
  car: boolean
  onSelect: (tab: 'issues' | 'artifacts' | 'settings') => void
  onClose: () => void
}) {
  const { colors, styles } = useTheme()
  const insets = useSafeAreaInsets()
  const items: { id: 'issues' | 'artifacts' | 'settings'; label: string; icon: IconName }[] = [
    ...(!car ? [{ id: 'issues' as const, label: 'Issues', icon: 'issues' as const }] : []),
    ...(!car && artifactsEnabled
      ? [{ id: 'artifacts' as const, label: 'Artifacts', icon: 'artifact' as const }]
      : []),
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ]
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close navigation menu"
          onPress={onClose}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
        />
        <View
          accessibilityViewIsModal
          accessibilityLabel="More navigation"
          onAccessibilityEscape={onClose}
          style={{
            position: 'absolute',
            right: Math.max(insets.right, 16),
            bottom: insets.bottom + (Platform.OS === 'ios' ? 80 : 68),
            width: 250,
            maxWidth: '90%',
            padding: 6,
            borderRadius: 20,
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderWidth: 1,
            boxShadow: '0 6px 24px rgba(0,0,0,0.2)',
          }}
        >
          {items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: active === item.id }}
              onPress={() => onSelect(item.id)}
              style={({ pressed }) => ({
                minHeight: 52,
                paddingHorizontal: 14,
                paddingVertical: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                borderRadius: 14,
                opacity: pressed ? 0.65 : 1,
              })}
            >
              <Icon name={item.icon} size={21} color={colors.text} />
              <Text style={[styles.text, { flex: 1 }]}>{item.label}</Text>
              {active === item.id && <Icon name="check" size={18} color={colors.accent} />}
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  )
}
