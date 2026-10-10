import {
  Children,
  createContext,
  isValidElement,
  useContext,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Text } from '../ui/content/text'
import { Switch } from '../ui/controls/switch'
import { Icon } from '../ui/controls/icon'
import { useSettingsTheme as useTheme } from './settings-theme'

const GroupContext = createContext(false)

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
    <View style={{ gap: 10 }}>
      {title && (
        <Text
          accessibilityRole="header"
          style={[
            styles.muted,
            { paddingHorizontal: 16, fontSize: 15, lineHeight: 21, fontWeight: '600' },
          ]}
        >
          {title}
        </Text>
      )}
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 24,
          overflow: 'hidden',
        }}
      >
        <GroupContext.Provider value>
          {Children.toArray(children).map((child, index) => (
            <View key={isValidElement(child) ? child.key : index}>
              {index > 0 && (
                <View
                  style={{
                    marginLeft: isValidElement(child) && child.type === SettingsRow ? 54 : 16,
                    marginRight: 16,
                    height: StyleSheet.hairlineWidth,
                    backgroundColor: colors.border,
                  }}
                />
              )}
              {child}
            </View>
          ))}
        </GroupContext.Provider>
      </View>
      {footer && <Text style={[styles.muted, { paddingHorizontal: 16 }]}>{footer}</Text>}
    </View>
  )
}

export function SettingsRow({
  title,
  subtitle,
  value,
  icon,
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
  value?: string
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
  const grouped = useContext(GroupContext)
  return (
    <Pressable
      testID={testID ?? label ?? title}
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      accessibilityValue={{ text: [value, subtitle, mark?.label].filter(Boolean).join('. ') }}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 16,
        gap: 14,
        minHeight: subtitle ? 70 : 56,
        opacity: disabled ? 0.45 : 1,
        backgroundColor: pressed ? colors.selection : 'transparent',
      })}
    >
      <View
        style={{
          width: 24,
          height: 24,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={22} color={colors.text} />
      </View>
      <View
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          minHeight: subtitle ? 70 : 56,
          paddingVertical: 12,
          marginRight: 16,
          borderBottomWidth: last || grouped ? 0 : StyleSheet.hairlineWidth,
          borderColor: colors.border,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={styles.text}>{title}</Text>
          {subtitle && <Text style={styles.muted}>{subtitle}</Text>}
        </View>
        {value && (
          <Text
            numberOfLines={1}
            style={[styles.text, { color: colors.muted, flexShrink: 1, maxWidth: '45%' }]}
          >
            {value}
          </Text>
        )}
        {selected && <Icon name="check" size={16} color={colors.accent} />}
        {mark && (
          <View accessibilityLabel={mark.label}>
            <Icon name={mark.icon} size={13} color={colors.muted} />
          </View>
        )}
        <Icon name="next" size={15} color={colors.muted} />
      </View>
    </Pressable>
  )
}

/** Native on/off control with room for larger text and a 44pt minimum touch target. */
export function SettingsSwitchRow({
  label,
  value,
  onValueChange,
  disabled = false,
  first = false,
}: {
  label: string
  value: boolean
  onValueChange: (value: boolean) => void
  disabled?: boolean
  first?: boolean
}) {
  const { colors, styles } = useTheme()
  const { fontScale } = useWindowDimensions()
  const grouped = useContext(GroupContext)
  return (
    <View
      style={{
        flexDirection: fontScale >= 1.5 ? 'column' : 'row',
        alignItems: fontScale >= 1.5 ? 'stretch' : 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        minHeight: 56,
      }}
    >
      {!first && !grouped && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 16,
            right: 16,
            height: StyleSheet.hairlineWidth,
            backgroundColor: colors.border,
          }}
        />
      )}
      <Text style={[styles.text, { flexShrink: 1, flexGrow: 1 }]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
      />
    </View>
  )
}
