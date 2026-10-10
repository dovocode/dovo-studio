import { Pressable, ScrollView, View } from 'react-native'
import { studioThemeIds, studioThemes, type StudioThemeColors } from '@dovo/studio-core/themes'
import {
  useMobilePreferences,
  updateMobilePreferences,
} from '../runtime/preferences/app-preferences'
import { nerdFontFamily } from '@dovo/studio-core/fonts'
import { SettingsChoice as Choice } from './settings-controls'
import { Icon } from '../ui/controls/icon'
import { Text } from '../ui/content/text'
import { ScreenHeader } from '../ui/layout/screen-header'
import { useSettingsTheme as useTheme, SettingsPage } from './settings-theme'
import { SettingsGroup } from './settings-group'

export default function AppearanceScreen() {
  const { colors, styles } = useTheme()
  const { theme, themePalette, terminalFontFamily, terminalFontSize } = useMobilePreferences()
  return (
    <SettingsPage>
      <ScreenHeader title="Appearance" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: 8, gap: 24 }]}>
        <Text style={[styles.muted, { fontSize: 13 }]}>This device · saved automatically</Text>
        <SettingsGroup title="Theme" footer="System follows your phone’s light or dark mode.">
          <Choice
            label="Color scheme"
            value={theme}
            items={[
              { id: 'system', name: 'System' },
              { id: 'light', name: 'Light' },
              { id: 'dark', name: 'Dark' },
            ]}
            onChange={(value) => {
              if (value === 'system' || value === 'light' || value === 'dark')
                updateMobilePreferences({ theme: value })
            }}
          />
        </SettingsGroup>
        <SettingsGroup
          title="Color palette"
          footer="The same palettes as desktop, with both light and dark previews."
        >
          {studioThemeIds.map((id) => {
            const palette = studioThemes[id]
            const selected = themePalette === id
            return (
              <Pressable
                key={id}
                testID={'Theme palette ' + palette.name}
                accessibilityRole="radio"
                accessibilityLabel={palette.name}
                accessibilityHint={palette.description}
                accessibilityState={{ checked: selected }}
                onPress={() => updateMobilePreferences({ themePalette: id })}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  backgroundColor: colors.surface,
                  alignItems: 'center',
                  minHeight: 70,
                  padding: 16,
                  gap: 12,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View
                  style={{ width: 84, flexDirection: 'row', borderRadius: 8, overflow: 'hidden' }}
                >
                  <PalettePreview colors={palette.dark} />
                  <PalettePreview colors={palette.light} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.text}>{palette.name}</Text>
                  <Text style={styles.muted}>{palette.description}</Text>
                </View>
                {selected && <Icon name="check" size={18} color={colors.text} />}
              </Pressable>
            )
          })}
        </SettingsGroup>
        <SettingsGroup
          title="Terminal"
          footer="JetBrains Mono Nerd Font is bundled for offline shell and developer icons. Changes apply to open terminals."
        >
          <Choice
            label="Terminal font"
            value={terminalFontFamily}
            items={[
              { id: '', name: 'System monospace' },
              { id: nerdFontFamily, name: nerdFontFamily },
            ]}
            onChange={(value) => {
              if (value === '' || value === nerdFontFamily)
                updateMobilePreferences({ terminalFontFamily: value })
            }}
          />
          <Choice
            label="Terminal font size"
            value={String(terminalFontSize)}
            items={Array.from({ length: 25 }, (_, index) => ({
              id: String(index + 8),
              name: `${index + 8} px`,
            }))}
            onChange={(value) => {
              const size = Number(value)
              if (Number.isInteger(size) && size >= 8 && size <= 32)
                updateMobilePreferences({ terminalFontSize: size })
            }}
          />
        </SettingsGroup>
      </ScrollView>
    </SettingsPage>
  )
}
function PalettePreview({ colors }: { colors: StudioThemeColors }) {
  return (
    <View
      accessible={false}
      style={{ width: '50%', height: 44, padding: 8, backgroundColor: colors.background, gap: 4 }}
    >
      <View
        style={{ height: 3, width: '80%', borderRadius: 2, backgroundColor: colors.foreground }}
      />
      <View style={{ height: 3, width: '50%', borderRadius: 2, backgroundColor: colors.primary }} />
      <View style={{ height: 3, width: '65%', borderRadius: 2, backgroundColor: colors.signal }} />
    </View>
  )
}
