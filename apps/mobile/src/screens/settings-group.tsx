import { SettingsAnchor, SettingsSearchContext } from './settings-search'
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useState,
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
  description,
  footer,
  children,
  advanced = false,
  searchLabels = [],
}: {
  advanced?: boolean
  searchLabels?: readonly string[]
  title?: string
  description?: string
  footer?: string
  children: ReactNode
}) {
  const { colors, styles, highContrast } = useTheme()
  const target = useContext(SettingsSearchContext)
  const searchMatch = !!target && (target === title || searchLabels.includes(target))
  const [expanded, setExpanded] = useState(searchMatch)
  useEffect(() => {
    if (searchMatch) setExpanded(true)
  }, [target, searchMatch])
  const open = !advanced || expanded

  return (
    <SettingsAnchor label={title}>
      <View style={{ gap: 8 }}>
        {advanced && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${open ? 'Hide' : 'Show'} ${title}`}
            accessibilityState={{ expanded: open }}
            onPress={() => setExpanded(!expanded)}
            style={{
              minHeight: 44,
              paddingHorizontal: 2,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Text style={[styles.text, { flex: 1, fontSize: 13, fontWeight: '600' }]}>{title}</Text>
            <Icon name={open ? 'down' : 'next'} size={16} color={colors.muted} />
          </Pressable>
        )}
        {title && !advanced && (
          <Text
            accessibilityRole="header"
            style={[
              styles.muted,
              {
                paddingHorizontal: 2,
                fontSize: 13,
                lineHeight: 18,
                fontWeight: '600',
                color: colors.text,
              },
            ]}
          >
            {title}
          </Text>
        )}
        {description && <Text style={[styles.muted, { paddingHorizontal: 2 }]}>{description}</Text>}
        {open && (
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 12,
              overflow: 'hidden',
              borderWidth: highContrast ? 1 : StyleSheet.hairlineWidth,
              borderColor: colors.border,
            }}
          >
            <GroupContext.Provider value>
              {Children.toArray(children).map((child, index) => (
                <View key={isValidElement(child) ? child.key : index}>
                  {index > 0 && (
                    <View
                      style={{
                        marginLeft: 12,
                        marginRight: 12,
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
        )}
        {footer && <Text style={[styles.muted, { paddingHorizontal: 2 }]}>{footer}</Text>}
      </View>
    </SettingsAnchor>
  )
}

export function SettingsRow({
  title,
  subtitle,
  value,
  icon,
  tint,
  onPress,
  label,
  testID,
  mark,
  disabled = false,
  selected = false,
  last = false,
  compact = false,
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
  mark?: {
    icon: ComponentProps<typeof Icon>['name']
    label: string
    accent?: boolean
    onPress?: () => void
  }
  disabled?: boolean
  selected?: boolean
  last?: boolean
  /** Navigation rows keep descriptions available to accessibility and search. */
  compact?: boolean
}) {
  const { colors, styles } = useTheme()
  const grouped = useContext(GroupContext)
  const { width, fontScale } = useWindowDimensions()
  const [contentWidth, setContentWidth] = useState<number | null>(null)
  const stacked = (!compact || fontScale >= 1.5) && (contentWidth ?? width) / fontScale < 360
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', position: 'relative' }}>
      <Pressable
        testID={testID ?? label ?? title}
        accessibilityRole="button"
        accessibilityLabel={label ?? title}
        accessibilityValue={{ text: [value, subtitle, mark?.label].filter(Boolean).join('. ') }}
        accessibilityState={{ disabled, selected }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 12,
          gap: 12,
          minHeight: subtitle && !compact ? 60 : 48,
          opacity: disabled ? 0.45 : 1,
          backgroundColor: pressed || selected ? colors.selection : 'transparent',
        })}
      >
        <View
          style={{
            width: compact ? 20 : 28,
            height: compact ? 24 : 28,
            borderRadius: 8,
            backgroundColor: compact ? 'transparent' : colors.background,
            borderWidth: compact ? 0 : StyleSheet.hairlineWidth,
            borderColor: selected ? colors.accent : colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={17} color={tint ?? (selected ? colors.accent : colors.muted)} />
        </View>
        <View
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            minHeight: subtitle && !compact ? 60 : 48,
            paddingVertical: compact ? 8 : 10,
            marginRight: 12,
            borderBottomWidth: last || grouped ? 0 : StyleSheet.hairlineWidth,
            borderColor: colors.border,
          }}
        >
          <View
            onLayout={({ nativeEvent }) => setContentWidth(nativeEvent.layout.width)}
            style={{
              flex: 1,
              minWidth: 0,
              flexDirection: stacked ? 'column' : 'row',
              alignItems: stacked ? 'stretch' : 'center',
              gap: stacked ? 4 : 8,
            }}
          >
            <View style={{ flex: stacked ? undefined : 1, minWidth: 0, gap: 2 }}>
              <Text style={[styles.text, { fontWeight: '500' }]}>{title}</Text>
              {subtitle && !compact && <Text style={styles.muted}>{subtitle}</Text>}
            </View>
            {value && (
              <Text
                numberOfLines={stacked ? undefined : 1}
                style={[
                  styles.text,
                  { color: colors.muted, flexShrink: 1, maxWidth: stacked ? undefined : '45%' },
                ]}
              >
                {value}
              </Text>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {selected && <Icon name="check" size={16} color={colors.accent} />}
            {mark &&
              (mark.onPress ? (
                <View style={{ width: 44 }} />
              ) : (
                <View accessibilityLabel={mark.label}>
                  <Icon name={mark.icon} size={13} color={colors.muted} />
                </View>
              ))}
            <Icon name="next" size={15} color={colors.muted} />
          </View>
        </View>
      </Pressable>
      {mark?.onPress && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={mark.label}
          onPress={mark.onPress}
          style={{
            position: 'absolute',
            right: 35,
            top: 0,
            bottom: 0,
            width: 44,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={mark.icon} size={15} color={colors.muted} />
        </Pressable>
      )}
    </View>
  )
}

/** Native on/off control with room for larger text and a 44pt minimum touch target. */
export function SettingsSwitchRow(props: ComponentProps<typeof SettingsSwitchControl>) {
  return (
    <SettingsAnchor label={props.label}>
      <SettingsSwitchControl {...props} />
    </SettingsAnchor>
  )
}
function SettingsSwitchControl({
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
        paddingHorizontal: 12,
        paddingVertical: 8,
        minHeight: 48,
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
