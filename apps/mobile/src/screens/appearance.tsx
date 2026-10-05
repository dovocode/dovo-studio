import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import { studioThemeIds, studioThemes, type StudioThemeColors } from '@dovo/studio-core/themes'
import {
  useMobilePreferences,
  updateMobilePreferences,
} from '../runtime/preferences/app-preferences'
import { Choice } from '../ui/controls/choice'
import { Icon } from '../ui/controls/icon'
import { Text } from '../ui/content/text'
import { ScreenHeader } from '../ui/layout/screen-header'
import { useTheme } from '../ui/theme'
import { SettingsGroup } from './settings-group'

export default function AppearanceScreen() {
  const { colors, styles } = useTheme()
  const { theme, themePalette } = useMobilePreferences()
  const { width } = useWindowDimensions()
  const columns = width >= 600 ? 3 : 2
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Appearance" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: 8, gap: 24 }]}>
        <Text style={[styles.muted, { fontSize: 12 }]}>This device · saved automatically</Text>
        <SettingsGroup title="Theme" footer="System follows your phone’s light or dark mode.">
          <View style={{ padding: 12 }}>
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
          </View>
        </SettingsGroup>
        <View style={{ gap: 12 }}>
          <Text style={[styles.muted, { paddingHorizontal: 10 }]}>COLOR PALETTE</Text>
          <Text style={styles.muted}>
            The same palettes as desktop, each with dark and light colors.
          </Text>
          <View
            accessibilityRole="radiogroup"
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}
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
                    width: (width - 32 - 10 * (columns - 1)) / columns,
                    padding: 10,
                    gap: 8,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: selected ? colors.accent : colors.border,
                    backgroundColor: selected ? colors.selection : colors.surface,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      borderRadius: 8,
                      overflow: 'hidden',
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <PalettePreview colors={palette.dark} />
                    <PalettePreview colors={palette.light} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.text, { fontSize: 14, fontWeight: '600', flex: 1 }]}>
                      {palette.name}
                    </Text>
                    {selected && <Icon name="check" size={15} color={colors.accent} />}
                  </View>
                  <Text style={[styles.muted, { fontSize: 12 }]}>{palette.description}</Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      </ScrollView>
    </View>
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
