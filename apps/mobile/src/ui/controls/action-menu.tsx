import { useEffect, useRef } from 'react'
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, type IconName } from './icon'
import { Text } from '../content/text'
import { useTheme } from '../theme'

export type MenuAnchor = { x: number; y: number; width: number; height: number }
export type MenuAction = {
  title: string
  label: string
  icon: IconName
  disabled: boolean
  onPress: () => void
}

/** Compact actions beside a control, outside scroll/Glass clipping and above the keyboard. */
export function ActionMenu({
  label,
  anchor,
  actions,
  onClose,
  align = 'end',
  dismissLabel = `Dismiss ${label}`,
}: {
  label: string
  anchor: MenuAnchor | null
  actions: MenuAction[]
  onClose: () => void
  align?: 'start' | 'end'
  dismissLabel?: string
}) {
  const { colors } = useTheme()
  const viewport = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const previousViewport = useRef(viewport)
  const afterDismiss = useRef<(() => void) | undefined>(undefined)
  const finishDismiss = () => {
    const action = afterDismiss.current
    afterDismiss.current = undefined
    action?.()
  }
  useEffect(() => {
    if (previousViewport.current.width !== viewport.width) onClose()
    previousViewport.current = viewport
  }, [viewport, onClose])
  // Presenting an iOS Modal may hide the TextInput's keyboard. That is not an outside tap.
  // Height changes update the bounds below; only a width/rotation change invalidates the anchor.
  const width = Math.min(264, viewport.width - insets.left - insets.right - 24)
  const bottom = Math.min(
    viewport.height - insets.bottom,
    Platform.OS === 'web' ? viewport.height : (Keyboard.metrics()?.screenY ?? viewport.height),
  )
  const height = Math.min(actions.length * 44 + 10, Math.max(44, bottom - insets.top - 16))
  const left = anchor
    ? Math.max(
        insets.left + 12,
        Math.min(
          align === 'start' ? anchor.x : anchor.x + anchor.width - width,
          viewport.width - insets.right - width - 12,
        ),
      )
    : 0
  const top = anchor
    ? Math.max(
        insets.top + 8,
        Math.min(
          anchor.y + anchor.height + height + 8 <= bottom
            ? anchor.y + anchor.height + 4
            : anchor.y - height - 4,
          bottom - height - 8,
        ),
      )
    : 0
  return (
    <Modal
      visible={!!anchor}
      transparent
      presentationStyle="overFullScreen"
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onDismiss={finishDismiss}
    >
      {anchor && (
        <View style={{ flex: 1 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={dismissLabel}
            onPress={onClose}
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
              maxHeight: height,
              paddingVertical: 4,
              borderRadius: 14,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              boxShadow: '0 6px 24px #00000030',
              overflow: 'hidden',
            }}
          >
            <ScrollView keyboardShouldPersistTaps="always" bounces={false}>
              {actions.map((action) => (
                <Pressable
                  key={action.label}
                  accessibilityRole="menuitem"
                  accessibilityLabel={action.label}
                  accessibilityState={{ disabled: action.disabled }}
                  disabled={action.disabled}
                  onPress={() => {
                    if (afterDismiss.current) return
                    afterDismiss.current = action.onPress
                    onClose()
                    if (Platform.OS !== 'ios') finishDismiss()
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
            </ScrollView>
          </View>
        </View>
      )}
    </Modal>
  )
}
