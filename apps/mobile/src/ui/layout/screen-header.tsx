import { appChannel } from '../../runtime/preferences/app-build'
import { createContext, useContext, type ReactNode } from 'react'
import { Stack } from 'expo-router'
import { Platform, Pressable, View } from 'react-native'
import { NavigationContext } from '../../shell/navigation'
import { Sheet, useInsideSheet } from './sheet'
import { Icon } from '../controls/icon'
import { useApplicationState } from '../../runtime/state/application-state'
import type { IconName } from '../controls/icon'
import { iconAssets } from '../controls/icon-assets'
import { IconButton } from '../controls/icon-button'
import { Text } from '../content/text'
import { useTheme } from '../theme'

/** Android/web: a screen inside a stack can show a back arrow in its own header. iOS uses the
 * native navigation bar's back button instead. */
export const ScreenBackContext = createContext<(() => void) | null>(null)

export type HeaderAction = {
  label: string
  icon: IconName
  onPress: () => void
  disabled?: boolean
  selected?: boolean
  overflow?: boolean
}

/** UIKit owns navigation sizing, button grouping and back gestures on iOS. */
export function ScreenHeader({
  title: screenTitle,
  titleContent,
  titleMenu = false,
  subtitle,
  leading,
  actions,
  buttons,
  testID,
  onBack,
  gestureEnabled = true,
  hidden = false,
}: {
  title: string
  titleContent?: ReactNode
  titleMenu?: boolean
  subtitle?: string
  leading?: ReactNode
  actions?: ReactNode
  buttons?: HeaderAction[]
  testID?: string
  onBack?: () => void
  gestureEnabled?: boolean
  hidden?: boolean
}) {
  const { colors } = useTheme()

  const title = appChannel ? `${screenTitle} · ${appChannel}` : screenTitle
  const navigation = useContext(NavigationContext)
  const inSheet = useInsideSheet()
  const [menu, setMenu] = useApplicationState(false)
  const heading = titleMenu ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Thread actions"
      onPress={() => setMenu(true)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
    >
      {titleContent ?? (
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>
          {title}
        </Text>
      )}
      <Icon name="down" size={14} color={colors.muted} />
    </Pressable>
  ) : (
    titleContent
  )
  // Sheets have their own close button; the page's back arrow belongs to the page header only.
  const contextBack = useContext(ScreenBackContext)
  const back = onBack ?? contextBack
  if (Platform.OS === 'ios' && !inSheet) {
    // PRs and pipelines keep their content mounted; only the visible collection owns the bar.
    if (navigation && !navigation.focused) return null
    if (hidden)
      return (
        <Stack.Screen
          options={{ headerShown: false, gestureEnabled: false, fullScreenGestureEnabled: false }}
        />
      )
    return (
      <>
        <Stack.Screen
          options={{
            title,
            ...(heading ? { headerTitle: () => heading } : {}),
            headerShown: true,
            headerBackVisible: !onBack,
            headerBackImageSource: iconAssets.back,
            gestureEnabled,
            fullScreenGestureEnabled: gestureEnabled ? undefined : false,
          }}
        />
        {!!onBack && (
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button
              icon={iconAssets.back}
              iconRenderingMode="template"
              accessibilityLabel="Back"
              onPress={onBack}
            >
              Back
            </Stack.Toolbar.Button>
          </Stack.Toolbar>
        )}
        <Stack.Toolbar placement="right">
          {buttons
            ?.filter((button) => !button.overflow)
            .map((button) => (
              <Stack.Toolbar.Button
                key={button.label}
                icon={iconAssets[button.icon]}
                iconRenderingMode="template"
                accessibilityLabel={button.label}
                disabled={button.disabled}
                selected={button.selected}
                tintColor={button.selected ? colors.accent : colors.text}
                onPress={button.onPress}
              >
                {button.label}
              </Stack.Toolbar.Button>
            ))}
          {buttons?.some((button) => button.overflow) && (
            <Stack.Toolbar.Menu
              icon={iconAssets.more}
              iconRenderingMode="template"
              accessibilityLabel="Task tools"
              tintColor={colors.text}
            >
              {buttons
                .filter((button) => button.overflow)
                .map((button) => (
                  <Stack.Toolbar.MenuAction
                    key={button.label}
                    icon={iconAssets[button.icon]}
                    iconRenderingMode="template"
                    disabled={button.disabled}
                    isOn={button.selected}
                    onPress={button.onPress}
                  >
                    {button.label}
                  </Stack.Toolbar.MenuAction>
                ))}
            </Stack.Toolbar.Menu>
          )}
          {!!actions && (
            <Stack.Toolbar.View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>{actions}</View>
            </Stack.Toolbar.View>
          )}
        </Stack.Toolbar>
        {!!subtitle && (
          <Text
            numberOfLines={1}
            style={{ color: colors.muted, fontSize: 13, paddingHorizontal: 16, paddingVertical: 6 }}
          >
            {subtitle}
          </Text>
        )}
        {menu && (
          <HeaderActionSheet
            title={screenTitle}
            buttons={buttons ?? []}
            onClose={() => setMenu(false)}
          />
        )}
      </>
    )
  }
  if (hidden) return null
  return (
    <View
      testID="Screen header"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 56,
        paddingHorizontal: 16,
        paddingVertical: 6,
        gap: 10,
      }}
    >
      {leading ?? (back && !inSheet && <IconButton label="Back" icon="back" onPress={back} />)}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {heading ?? (
          <>
            <Text
              testID={testID}
              accessibilityRole="header"
              numberOfLines={1}
              style={{ color: colors.text, fontSize: 16, fontWeight: '600', letterSpacing: -0.3 }}
            >
              {title}
            </Text>
            {!!subtitle && (
              <Text
                numberOfLines={1}
                accessibilityLabel={subtitle}
                style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}
              >
                {subtitle}
              </Text>
            )}
          </>
        )}
      </View>
      {(!!actions || !!buttons?.length) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 0, gap: 2 }}>
          {buttons
            ?.filter((button) => !button.overflow)
            .map((button) => (
              <IconButton key={button.label} {...button} />
            ))}
          {/* Android has no toolbar menu; the same overflow actions open in a sheet. */}
          {buttons?.some((button) => button.overflow) && (
            <IconButton label="More actions" icon="more" onPress={() => setMenu(true)} />
          )}
          {actions}
        </View>
      )}
      {menu && (
        <HeaderActionSheet
          title={screenTitle}
          buttons={buttons ?? []}
          onClose={() => setMenu(false)}
        />
      )}
    </View>
  )
}

function HeaderActionSheet({
  title,
  buttons,
  onClose,
}: {
  title: string
  buttons: HeaderAction[]
  onClose: () => void
}) {
  const { colors } = useTheme()
  return (
    <Sheet title={title} onClose={onClose}>
      {buttons
        ?.filter((button) => button.overflow)
        .map((button) => (
          <Pressable
            key={button.label}
            accessibilityRole="button"
            accessibilityLabel={button.label}
            accessibilityState={{ disabled: button.disabled, selected: button.selected }}
            disabled={button.disabled}
            onPress={() => {
              onClose()
              button.onPress()
            }}
            style={({ pressed }) => ({
              minHeight: 52,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              opacity: button.disabled ? 0.4 : pressed ? 0.6 : 1,
            })}
          >
            <Icon
              name={button.icon}
              size={20}
              color={button.selected ? colors.accent : colors.text}
            />
            <Text
              style={{
                color: button.selected ? colors.accent : colors.text,
                fontSize: 17,
                lineHeight: 22,
                flex: 1,
                minWidth: 0,
              }}
            >
              {button.label}
            </Text>
          </Pressable>
        ))}
    </Sheet>
  )
}
