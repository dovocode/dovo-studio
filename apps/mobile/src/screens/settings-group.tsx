import type { ComponentProps, ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../ui/content/text'
import { Icon } from '../ui/controls/icon'
import { useTheme } from '../ui/theme'

export function SettingsGroup({
  title,
  footer,
  children,
}: {
  title?: string
  footer?: string
  children: ReactNode
}) {
  const { colors, styles } = useTheme()

  return (
    <View style={{ gap: 6 }}>
      {title && (
        <Text
          style={[
            styles.muted,
            { paddingHorizontal: 10, fontSize: 12, fontWeight: '600', letterSpacing: 0.4 },
          ]}
        >
          {title}
        </Text>
      )}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 14,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
      {footer && <Text style={[styles.muted, { paddingHorizontal: 10 }]}>{footer}</Text>}
    </View>
  )
}

export function SettingsRow({
  title,
  subtitle,
  icon,
  tint,
  onPress,
  label,
  testID,
  mark,
  disabled = false,
  selected = false,
  last = false,
}: {
  title: string
  subtitle?: string
  icon: ComponentProps<typeof Icon>['name']
  tint?: string
  onPress: () => void
  label?: string
  testID?: string
  /** Where the page saves, shown before the chevron. */
  mark?: { icon: ComponentProps<typeof Icon>['name']; label: string; accent?: boolean }
  disabled?: boolean
  selected?: boolean
  last?: boolean
}) {
  const { colors, styles } = useTheme()
  const iconTint = tint ?? colors.accent
  return (
    <Pressable
      testID={testID ?? label ?? title}
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      accessibilityValue={subtitle ? { text: subtitle } : undefined}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 10,
        gap: 8,
        minHeight: subtitle ? 56 : 44,
        opacity: disabled ? 0.45 : 1,
        backgroundColor: pressed ? colors.selection : 'transparent',
      })}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${iconTint}20`,
        }}
      >
        <Icon name={icon} size={16} color={iconTint} />
      </View>
      <View
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 6,
          paddingRight: 10,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderColor: colors.border,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={2} style={[styles.text, { fontSize: 15, lineHeight: 20 }]}>
            {title}
          </Text>
          {subtitle && (
            <Text numberOfLines={2} style={styles.muted}>
              {subtitle}
            </Text>
          )}
        </View>
        {selected && <Icon name="check" size={16} color={colors.accent} />}
        {mark && (
          <View accessibilityLabel={mark.label}>
            <Icon name={mark.icon} size={13} color={mark.accent ? colors.accent : colors.muted} />
          </View>
        )}
        <Icon name="next" size={12} color={colors.muted} />
      </View>
    </Pressable>
  )
}
