import type { ComponentProps, ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../ui/text'
import { Icon } from '../ui/icon'
import { colors, styles } from '../ui/theme'

export function SettingsGroup({
  title,
  footer,
  children,
}: {
  title?: string
  footer?: string
  children: ReactNode
}) {
  return (
    <View style={{ gap: 6 }}>
      {title && <Text style={[styles.muted, { paddingHorizontal: 10 }]}>{title}</Text>}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 10,
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
  tint = colors.accent,
  onPress,
  label,
  testID,
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
  disabled?: boolean
  selected?: boolean
  last?: boolean
}) {
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
        backgroundColor: pressed ? '#ffffff12' : 'transparent',
      })}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${tint}20`,
        }}
      >
        <Icon name={icon} size={16} color={tint} />
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
        <Icon name="next" size={12} color={colors.muted} />
      </View>
    </Pressable>
  )
}
