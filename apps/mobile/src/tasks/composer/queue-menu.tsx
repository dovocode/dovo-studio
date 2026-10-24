import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { Modal, Pressable, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from '../../ui/controls/icon'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export type QueueMenuProps = {
  label: string
  actions: {
    title: string
    label: string
    icon: IconName
    disabled: boolean
    onPress: () => void
  }[]
}

/** Keep queue actions anchored to their row, outside the bounded queue's clipping area. */
export function QueueMenu({ label, actions }: QueueMenuProps) {
  const { colors } = useTheme()
  const viewport = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const trigger = useRef<ComponentRef<typeof View>>(null)
  const [anchor, setAnchor] = useState<{ x: number; y: number; height: number } | null>(null)
  useEffect(() => setAnchor(null), [viewport.width, viewport.height])
  const width = Math.min(264, viewport.width - insets.left - insets.right - 24)
  const height = actions.length * 44 + 8
  const left = anchor
    ? Math.max(
        insets.left + 12,
        Math.min(anchor.x + 44 - width, viewport.width - insets.right - width - 12),
      )
    : 0
  const top = anchor
    ? Math.max(
        insets.top + 8,
        Math.min(
          anchor.y + anchor.height + height + 8 <= viewport.height - insets.bottom
            ? anchor.y + anchor.height + 4
            : anchor.y - height - 4,
          viewport.height - insets.bottom - height - 8,
        ),
      )
    : 0
  return (
    <View ref={trigger} collapsable={false} style={{ width: 44, height: 44, flexShrink: 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: !!anchor }}
        onPress={() =>
          trigger.current?.measureInWindow((x, y, _width, height) => setAnchor({ x, y, height }))
        }
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="more" size={20} color={colors.muted} />
      </Pressable>
      {anchor && (
        <Modal
          transparent
          animationType="none"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={() => setAnchor(null)}
        >
          <View style={{ flex: 1 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss queued message actions"
              onPress={() => setAnchor(null)}
              style={{ position: 'absolute', inset: 0 }}
            />
            <View
              accessibilityRole="menu"
              accessibilityLabel={label}
              accessibilityViewIsModal
              style={{
                position: 'absolute',
                left,
                top,
                width,
                paddingVertical: 4,
                borderRadius: 14,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                boxShadow: '0 6px 24px #00000030',
                overflow: 'hidden',
              }}
            >
              {actions.map((action) => (
                <Pressable
                  key={action.label}
                  accessibilityRole="menuitem"
                  accessibilityLabel={action.label}
                  accessibilityState={{ disabled: action.disabled }}
                  disabled={action.disabled}
                  onPress={() => {
                    setAnchor(null)
                    action.onPress()
                  }}
                  style={({ pressed }) => ({
                    minHeight: 44,
                    paddingHorizontal: 14,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    opacity: action.disabled ? 0.4 : 1,
                    backgroundColor: pressed ? colors.selection : 'transparent',
                  })}
                >
                  <Icon name={action.icon} size={18} color={colors.text} />
                  <Text style={{ color: colors.text, fontSize: 14 }}>{action.title}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Modal>
      )}
    </View>
  )
}
