import { useState } from 'react'
import { View } from 'react-native'
import { threadInfoSections } from '@dovo/protocol'
import {
  readMobilePreferences,
  updateMobilePreferences,
  useMobilePreferences,
} from '../../runtime/preferences/app-preferences'
import { Action } from '../../ui/controls/action'
import { Switch } from '../../ui/controls/switch'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function ThreadInfoCustomization() {
  const [open, setOpen] = useState(false)
  const { threadInfoSections: choices, ready } = useMobilePreferences()
  const { styles } = useTheme()
  return (
    <View style={{ gap: 8 }}>
      <Action
        secondary
        label={open ? 'Done customizing thread info' : 'Customize thread info'}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          <Text style={styles.muted}>Show in thread info · Saved on this device</Text>
          {threadInfoSections
            .filter((section) => !('desktopOnly' in section && section.desktopOnly))
            .map(({ id, label }) => (
              <View
                key={id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}
              >
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
            ))}
          <Action
            secondary
            label="Reset to default"
            disabled={!ready || !Object.values(choices).some((visible) => !visible)}
            onPress={() => updateMobilePreferences({ threadInfoSections: {} })}
          />
        </>
      )}
    </View>
  )
}
