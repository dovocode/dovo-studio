import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { type ReactNode } from 'react'
import { View } from 'react-native'
import { orderedThreadInfoSections, moveThreadInfoSection } from '@dovo/protocol'
import {
  readMobilePreferences,
  updateMobilePreferences,
  useMobilePreferences,
} from '../../runtime/preferences/app-preferences'
import { IconButton } from '../../ui/controls/icon-button'
import { Action } from '../../ui/controls/action'
import { Switch } from '../../ui/controls/switch'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function ThreadInfoCustomization({
  children,
  inline,
  open,
  onOpenChange,
}: {
  children: ReactNode
  inline: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const uiText = useInterfaceText()

  const { threadInfoSections: choices, threadInfoOrder, ready } = useMobilePreferences()
  const { styles } = useTheme()
  const sections = orderedThreadInfoSections(threadInfoOrder).filter(
    (section) => !('desktopOnly' in section && section.desktopOnly),
  )
  if (!inline && !open) return null
  return (
    <View style={{ gap: 8 }}>
      {inline && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 4 }}>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>{children}</View>
          <IconButton
            icon={open ? 'check' : 'tune'}
            label={open ? uiText('Done customizing thread info') : uiText('Customize thread info')}
            onPress={() => onOpenChange(!open)}
          />
        </View>
      )}
      {open && (
        <>
          <Text style={styles.muted}>
            <InterfaceText>{'Show and arrange thread info · Saved on this device'}</InterfaceText>
          </Text>
          {sections.map(({ id, label }, index) => (
            <View key={id} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
                <Text style={[styles.text, { flex: 1 }]}>{label}</Text>
                <Switch
                  accessibilityLabel={label}
                  value={choices[id] !== false}
                  disabled={!ready}
                  onValueChange={(visible) =>
                    updateMobilePreferences({
                      threadInfoSections: {
                        ...readMobilePreferences().threadInfoSections,
                        [id]: visible,
                      },
                    })
                  }
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([-1, 1] as const).map((direction) => (
                  <IconButton
                    key={direction}
                    icon={direction === -1 ? 'moveUp' : 'moveDown'}
                    label={uiText('Move {value0} {value1}', {
                      value0: label,
                      value1: direction === -1 ? 'up' : 'down',
                    })}
                    disabled={
                      !ready || (direction === -1 ? index === 0 : index === sections.length - 1)
                    }
                    onPress={() =>
                      updateMobilePreferences({
                        threadInfoOrder: moveThreadInfoSection(
                          readMobilePreferences().threadInfoOrder,
                          id,
                          direction,
                          true,
                        ),
                      })
                    }
                  />
                ))}
              </View>
            </View>
          ))}
          <Action
            secondary
            label={uiText('Reset to default')}
            disabled={
              !ready ||
              (!Object.values(choices).some((visible) => !visible) && !threadInfoOrder?.length)
            }
            onPress={() => updateMobilePreferences({ threadInfoSections: {}, threadInfoOrder: [] })}
          />
        </>
      )}
    </View>
  )
}
