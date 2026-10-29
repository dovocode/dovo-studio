import { useEffect, useRef } from 'react'
import { FullWindowOverlay } from 'react-native-screens'
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
  // A menu can appear while the trigger's original touch is still down. Only a fresh
  // press beginning inside this menu may activate it or dismiss its backdrop.
  const freshPress = useRef<string | null>(null)
  useEffect(() => {
    freshPress.current = null
  }, [anchor])
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
  // The iOS overlay shares the current window, preserving the TextInput first responder.
  // Only a width/rotation change invalidates its measured anchor.
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
  const content = anchor && (
    <View style={{ flex: 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={dismissLabel}
        onPressIn={() => {
          freshPress.current = 'backdrop'
        }}
        onPress={() => {
          if (freshPress.current !== 'backdrop') return
          freshPress.current = null
          onClose()
        }}
        onAccessibilityTap={onClose}
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
          {actions.map((action) => {
            const activate = () => {
              if (action.disabled || afterDismiss.current) return
              afterDismiss.current = action.onPress
              onClose()
              finishDismiss()
            }
            return (
              <Pressable
                key={action.label}
                accessibilityRole="menuitem"
                accessibilityLabel={action.label}
                accessibilityState={{ disabled: action.disabled }}
                disabled={action.disabled}
                onPressIn={() => {
                  freshPress.current = action.label
                }}
                onPress={() => {
                  if (freshPress.current !== action.label) return
                  freshPress.current = null
                  activate()
                }}
                onAccessibilityTap={activate}
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
            )
          })}
        </ScrollView>
      </View>
    </View>
  )
  if (Platform.OS === 'ios')
    return anchor ? (
      <FullWindowOverlay unstable_accessibilityContainerViewIsModal>{content}</FullWindowOverlay>
    ) : null
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
      {content}
    </Modal>
  )
}
