import { appChannel } from '../../runtime/preferences/app-build'
import { createContext, useContext, useRef, type ReactNode } from 'react'
import { Stack } from 'expo-router'
import { Platform, Pressable, View } from 'react-native'
import { NavigationContext } from '../../shell/navigation'
import { Sheet, useInsideSheet, type SheetHandle } from './sheet'
import { Icon } from '../controls/icon'
import { useApplicationState } from '../../runtime/state/application-state'
import type { IconName } from '../controls/icon'
import { iconAssets } from '../controls/icon-assets'
import { IconButton } from '../controls/icon-button'
import { Text } from '../content/text'
import { useTheme } from '../theme'

/** Route-owned back actions work in both the native iOS toolbar and Android/web headers. */
export const InlineScreenHeaderContext = createContext(false)

export const ScreenBackContext = createContext<(() => void) | null>(null)

export type HeaderAction = {
  label: string
  icon: IconName
  onPress: () => void
  disabled?: boolean
  selected?: boolean
  overflow?: boolean
  group?: string
  destructive?: boolean
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
  collapsedMenuGroups = [],
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
  collapsedMenuGroups?: readonly string[]
  testID?: string
  onBack?: () => void
  gestureEnabled?: boolean
  hidden?: boolean
}) {
  const { colors } = useTheme()

  const title = appChannel ? `${screenTitle} · ${appChannel}` : screenTitle
  const navigation = useContext(NavigationContext)
  const inSheet = useInsideSheet()
  const inline = useContext(InlineScreenHeaderContext)
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
  if (Platform.OS === 'ios' && !inSheet && !inline) {
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
            headerBackVisible: !back,
            headerBackImageSource: iconAssets.back,
            gestureEnabled,
            fullScreenGestureEnabled: gestureEnabled ? undefined : false,
          }}
        />
        {!!back && (
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button
              icon={iconAssets.back}
              iconRenderingMode="template"
              accessibilityLabel="Back"
              onPress={back}
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
              accessibilityLabel="More actions"
              tintColor={colors.text}
            >
              {groupHeaderActions(buttons).map(({ name, actions }) => {
                const items = actions.map((button) => (
                  <Stack.Toolbar.MenuAction
                    key={button.label}
                    icon={iconAssets[button.icon]}
                    iconRenderingMode="template"
                    disabled={button.disabled}
                    isOn={button.selected}
                    destructive={button.destructive}
                    onPress={button.onPress}
                  >
                    {button.label}
                  </Stack.Toolbar.MenuAction>
                ))
                return name ? (
                  <Stack.Toolbar.Menu
                    key={name}
                    title={name}
                    inline={!collapsedMenuGroups.includes(name)}
                  >
                    {items}
                  </Stack.Toolbar.Menu>
                ) : (
                  items
                )
              })}
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
            collapsedGroups={collapsedMenuGroups}
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
          collapsedGroups={collapsedMenuGroups}
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
  collapsedGroups,
}: {
  title: string
  buttons: HeaderAction[]
  collapsedGroups: readonly string[]
  onClose: () => void
}) {
  const { colors } = useTheme()
  const [expanded, setExpanded] = useApplicationState<string[]>([])
  const sheet = useRef<SheetHandle>(null)
  return (
    <Sheet ref={sheet} title={title} onClose={onClose}>
      {groupHeaderActions(buttons).map(({ name, actions }) => (
        <View key={name} style={{ gap: name ? 2 : 12 }}>
          {!!name &&
            (collapsedGroups.includes(name) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={name}
                accessibilityState={{ expanded: expanded.includes(name) }}
                onPress={() =>
                  setExpanded((current) =>
                    current.includes(name)
                      ? current.filter((item) => item !== name)
                      : [...current, name],
                  )
                }
                style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 }}
              >
                <Text style={{ color: colors.text, fontSize: 17, flex: 1 }}>{name}</Text>
                <Icon
                  name={expanded.includes(name) ? 'down' : 'next'}
                  size={18}
                  color={colors.muted}
                />
              </Pressable>
            ) : (
              <Text
                accessibilityRole="header"
                style={{
                  color: colors.muted,
                  fontSize: 12,
                  fontWeight: '600',
                  paddingTop: 16,
                  paddingBottom: 4,
                }}
              >
                {name}
              </Text>
            ))}
          {(!collapsedGroups.includes(name) || expanded.includes(name)) &&
            actions.map((button) => (
              <Pressable
                key={button.label}
                accessibilityRole="button"
                accessibilityLabel={button.label}
                accessibilityState={{ disabled: button.disabled, selected: button.selected }}
                disabled={button.disabled}
                onPress={() => {
                  sheet.current?.dismiss(button.onPress)
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
                  color={
                    button.destructive
                      ? colors.error
                      : button.selected
                        ? colors.accent
                        : colors.text
                  }
                />
                <Text
                  style={{
                    color: button.destructive
                      ? colors.error
                      : button.selected
                        ? colors.accent
                        : colors.text,
                    fontSize: 17,
                    lineHeight: 22,
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {button.label}
                </Text>
                {button.selected && <Icon name="check" size={18} color={colors.accent} />}
              </Pressable>
            ))}
        </View>
      ))}
    </Sheet>
  )
}

function groupHeaderActions(buttons: readonly HeaderAction[]) {
  const groups = new Map<string, HeaderAction[]>()
  for (const button of buttons) {
    if (!button.overflow) continue
    const name = button.group ?? ''
    const actions = groups.get(name) ?? []
    actions.push(button)
    groups.set(name, actions)
  }
  return Array.from(groups, ([name, actions]) => ({ name, actions }))
}
