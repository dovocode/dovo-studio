import { SettingsAnchor } from './settings-search'
import { Field } from '../ui/controls/field'
import { useState, type ComponentProps } from 'react'
import { Platform, Pressable, View, useWindowDimensions } from 'react-native'
import { Choice, type ChoiceProps } from '../ui/controls/choice'
import { SearchField } from '../ui/controls/field'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { MobileThemeContext, useTheme } from '../ui/theme'
import { useInsideSettings } from './settings-theme'
import { useInsideSheet } from '../ui/layout/sheet'

/** Preserve native choice menus, with a quiet trailing value in settings. */
export function SettingsChoice(props: ChoiceProps) {
  return (
    <SettingsAnchor label={props.label}>
      <SettingsChoiceControl {...props} />
    </SettingsAnchor>
  )
}
function SettingsChoiceControl(props: ChoiceProps) {
  const settings = useInsideSettings()
  const theme = useTheme()
  const { width, fontScale } = useWindowDimensions()
  const insideSheet = useInsideSheet()
  const [containerWidth, setContainerWidth] = useState<number | null>(null)
  if (!settings) return <Choice {...props} />
  // Searchable choices expand inline in an editor. Give their options the full row width.
  const inlineOptions =
    insideSheet && !(Platform.OS === 'ios' && props.items.length > 0 && props.items.length <= 12)
  const horizontal =
    !inlineOptions && fontScale < 1.5 && (containerWidth ?? width) / fontScale >= 360
  return (
    <View onLayout={({ nativeEvent }) => setContainerWidth(nativeEvent.layout.width)}>
      <View
        style={{
          flexDirection: horizontal ? 'row' : 'column',
          alignItems: horizontal ? 'center' : 'stretch',
          minHeight: 48,
          paddingHorizontal: 12,
          paddingTop: horizontal || props.hideLabel ? 0 : 10,
          gap: 8,
        }}
      >
        {!props.hideLabel && (
          <Text
            style={[
              theme.styles.text,
              { flexShrink: 1, flexBasis: horizontal ? '45%' : undefined },
            ]}
          >
            {props.label}
          </Text>
        )}
        <View style={{ flex: horizontal ? 1 : undefined, minWidth: 0 }}>
          <MobileThemeContext.Provider
            value={{
              ...theme,
              colors: { ...theme.colors, accent: theme.colors.muted, text: theme.colors.muted },
            }}
          >
            <Choice
              {...props}
              row={false}
              hideLabel
              compact={false}
              quiet
              alignValue={horizontal ? 'trailing' : 'leading'}
            />
          </MobileThemeContext.Provider>
        </View>
      </View>
    </View>
  )
}

// Field reads the current theme itself; duplicating input styles would override multiline sizing.
export function SettingsField(props: ComponentProps<typeof Field>) {
  return (
    <SettingsAnchor label={props.label}>
      <Field {...props} />
    </SettingsAnchor>
  )
}

export function SettingsSearchField(props: ComponentProps<typeof SearchField>) {
  const settings = useInsideSettings()
  if (!settings) return <SearchField {...props} />
  return <SearchField {...props} style={[{ fontSize: 14 }, props.style]} />
}

/** Editor actions must remain readable, including save, retry and destructive actions. */
export function SettingsAction(props: ComponentProps<typeof Action>) {
  const settings = useInsideSettings()
  const { colors } = useTheme()
  if (!settings) return <Action {...props} />
  const danger = /^(Forget|Delete|Remove|Revoke|Discard)\b/.test(props.label)
  return (
    <Pressable
      testID={props.label}
      accessibilityLabel={props.label}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        maxWidth: '100%',
        flexShrink: 1,
        alignSelf: props.wide ? 'stretch' : 'flex-start',
        justifyContent: 'center',
        paddingHorizontal: props.secondary ? 0 : 16,
        paddingVertical: 8,
        borderRadius: 10,
        backgroundColor: props.secondary ? 'transparent' : danger ? colors.error : colors.action,
        opacity: props.disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Text
        style={{
          fontSize: 14,
          lineHeight: 20,
          fontWeight: '600',
          textAlign: props.wide ? 'center' : 'left',
          color: props.secondary
            ? danger
              ? colors.error
              : colors.text
            : danger
              ? colors.onError
              : colors.onAccent,
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  )
}
