import type { ComponentProps } from 'react'
import { Platform, Pressable, View, useWindowDimensions } from 'react-native'
import { Choice, type ChoiceProps } from '../ui/controls/choice'
import { Field, SearchField } from '../ui/controls/field'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { MobileThemeContext, useTheme } from '../ui/theme'
import { useInsideSettings } from './settings-theme'
import { useInsideSheet } from '../ui/layout/sheet'

/** Preserve native choice menus, with a quiet trailing value in settings. */
export function SettingsChoice(props: ChoiceProps) {
  const settings = useInsideSettings()
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const insideSheet = useInsideSheet()
  if (!settings) return <Choice {...props} />
  // Searchable choices expand inline in an editor. Give their options the full row width.
  if (insideSheet && !(Platform.OS === 'ios' && props.items.length > 0 && props.items.length <= 12))
    return (
      <MobileThemeContext.Provider
        value={{ ...theme, colors: { ...theme.colors, accent: theme.colors.muted } }}
      >
        <Choice {...props} row={!props.hideLabel} compact={false} />
      </MobileThemeContext.Provider>
    )
  const horizontal = fontScale < 1.5
  return (
    <View style={{ backgroundColor: theme.colors.surface, borderRadius: 20, overflow: 'hidden' }}>
      <View
        style={{
          flexDirection: horizontal ? 'row' : 'column',
          alignItems: horizontal ? 'center' : 'stretch',
          minHeight: 54,
          paddingHorizontal: 16,
          paddingVertical: 5,
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
            <Choice {...props} row={false} hideLabel compact={false} />
          </MobileThemeContext.Provider>
        </View>
      </View>
    </View>
  )
}

export function SettingsField(props: ComponentProps<typeof Field>) {
  const settings = useInsideSettings()
  const { styles } = useTheme()
  return <Field {...props} style={settings ? [styles.input, props.style] : props.style} />
}

export function SettingsSearchField(props: ComponentProps<typeof SearchField>) {
  const settings = useInsideSettings()
  const theme = useTheme()
  const { colors } = theme
  if (!settings) return <SearchField {...props} />
  // The existing search control is reused inside a borderless settings surface.
  return (
    <MobileThemeContext.Provider
      value={{ ...theme, colors: { ...colors, border: colors.surface } }}
    >
      <SearchField {...props} />
    </MobileThemeContext.Provider>
  )
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
        paddingVertical: 10,
        borderRadius: 22,
        backgroundColor: props.secondary ? 'transparent' : danger ? colors.error : colors.action,
        opacity: props.disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Text
        style={{
          fontSize: 17,
          lineHeight: 23,
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
