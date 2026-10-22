import { SettingsScrollView } from './settings-search'
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
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
import { SettingsGroup, SettingsSwitchRow } from './settings-group'
import { CodeThemeSettings } from './code-theme'

export default function AppearanceScreen() {
  const { colors, styles } = useTheme()
  const {
    theme,
    themePalette,
    threadDensity,
    terminalFontFamily,
    terminalFontSize,
    highContrast,
    colorVision,
    motion,
  } = useMobilePreferences()
  return (
    <SettingsPage>
      <ScreenHeader title="Appearance" />
      <SettingsScrollView contentContainerStyle={[styles.content, { paddingTop: 8, gap: 24 }]}>
        <Text style={[styles.muted, { fontSize: 13 }]}>This device · saved automatically</Text>
        <SettingsGroup
          title="Accessibility"
          footer="Status icons and labels work without color. Text follows your phone’s text size setting."
        >
          <Choice
            label="Status colors"
            value={colorVision}
            items={[
              { id: 'default', name: 'Default' },
              { id: 'blue-orange', name: 'Blue / orange' },
            ]}
            onChange={(value) => {
              if (value === 'default' || value === 'blue-orange')
                updateMobilePreferences({ colorVision: value })
            }}
          />
          <View
            accessibilityLabel="Status color preview"
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, padding: 16 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <CircleCheck size={16} color={colors.success} accessible={false} />
              <Text style={[styles.muted, { color: colors.success }]}>Finished</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <CircleX size={16} color={colors.error} accessible={false} />
              <Text style={[styles.muted, { color: colors.error }]}>Failed</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <TriangleAlert size={16} color={colors.warning} accessible={false} />
              <Text style={[styles.muted, { color: colors.warning }]}>Needs input</Text>
            </View>
          </View>
          <SettingsSwitchRow
            label="Higher contrast"
            value={highContrast}
            onValueChange={(highContrast) => updateMobilePreferences({ highContrast })}
          />
          <Choice
            label="Animations"
            value={motion}
            items={[
              { id: 'system', name: 'System' },
              { id: 'reduce', name: 'Reduce' },
            ]}
            onChange={(value) => {
              if (value === 'system' || value === 'reduce')
                updateMobilePreferences({ motion: value })
            }}
          />
        </SettingsGroup>
        <SettingsGroup
          title="Layout"
          footer="Compact uses uniform rows with smaller text and single-line details. Comfortable keeps the original layout with more room for context."
        >
          <Choice
            label="Thread density"
            value={threadDensity}
            items={[
              { id: 'compact', name: 'Compact' },
              { id: 'comfortable', name: 'Comfortable' },
            ]}
            onChange={(value) => {
              if (value === 'compact' || value === 'comfortable')
                updateMobilePreferences({ threadDensity: value })
            }}
          />
        </SettingsGroup>
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
                aria-checked={selected}
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
        <CodeThemeSettings />
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
      </SettingsScrollView>
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
