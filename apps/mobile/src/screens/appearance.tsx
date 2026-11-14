import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { botLayouts, isBotLayout } from '@dovo/protocol'
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
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()
  const {
    theme,
    themePalette,
    threadDensity,
    botLayout,
    botsInThreads,
    botsOverviewEnabled,
    terminalFontFamily,
    terminalFontSize,
    highContrast,
    colorVision,
    motion,
  } = useMobilePreferences()
  return (
    <SettingsPage>
      <ScreenHeader title={uiText('Appearance')} />
      <SettingsScrollView contentContainerStyle={[styles.content, { paddingTop: 8, gap: 24 }]}>
        <Text style={[styles.muted, { fontSize: 13 }]}>
          <InterfaceText>{'This device · saved automatically'}</InterfaceText>
        </Text>
        <SettingsGroup
          title={uiText('Accessibility')}
          footer={uiText(
            'Status icons and labels work without color. Text follows your phone’s text size setting.',
          )}
        >
          <Choice
            label={uiText('Status colors')}
            value={colorVision}
            items={[
              { id: 'default', name: uiText('Normal') },
              { id: 'blue-orange', name: uiText('GitHub colorblind') },
            ]}
            onChange={(value) => {
              if (value === 'default' || value === 'blue-orange')
                updateMobilePreferences({ colorVision: value })
            }}
          />
          <View
            accessibilityLabel={uiText('Status color preview')}
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 12 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <CircleCheck size={16} color={colors.success} accessible={false} />
              <Text style={[styles.muted, { color: colors.success }]}>
                <InterfaceText>{'Finished'}</InterfaceText>
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <CircleX size={16} color={colors.error} accessible={false} />
              <Text style={[styles.muted, { color: colors.error }]}>
                <InterfaceText>{'Failed'}</InterfaceText>
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <TriangleAlert size={16} color={colors.warning} accessible={false} />
              <Text style={[styles.muted, { color: colors.warning }]}>
                <InterfaceText>{'Needs input'}</InterfaceText>
              </Text>
            </View>
          </View>
          <SettingsSwitchRow
            label={uiText('Higher contrast')}
            value={highContrast}
            onValueChange={(highContrast) => updateMobilePreferences({ highContrast })}
          />
          <Choice
            label={uiText('Animations')}
            value={motion}
            items={[
              { id: 'system', name: uiText('System') },
              { id: 'reduce', name: uiText('Reduce') },
            ]}
            onChange={(value) => {
              if (value === 'system' || value === 'reduce')
                updateMobilePreferences({ motion: value })
            }}
          />
        </SettingsGroup>
        <SettingsGroup
          title={uiText('Layout')}
          footer={uiText(
            'Compact uses uniform rows with smaller text and single-line details. Comfortable keeps the original layout with more room for context.',
          )}
        >
          <SettingsSwitchRow
            label={uiText('Bots in thread overview')}
            value={botsInThreads}
            onValueChange={(botsInThreads) => updateMobilePreferences({ botsInThreads })}
          />
          <SettingsSwitchRow
            label={uiText('Separate Bots overview')}
            value={botsOverviewEnabled}
            onValueChange={(botsOverviewEnabled) =>
              updateMobilePreferences({ botsOverviewEnabled })
            }
          />
          <Choice
            label={uiText('Bot layout')}
            value={botLayout}
            items={botLayouts.map((item) => ({ ...item, name: uiText(item.name) }))}
            onChange={(value) => {
              if (isBotLayout(value)) updateMobilePreferences({ botLayout: value })
            }}
          />
          <Choice
            label={uiText('Thread density')}
            value={threadDensity}
            items={[
              { id: 'compact', name: uiText('Compact') },
              { id: 'comfortable', name: uiText('Comfortable') },
            ]}
            onChange={(value) => {
              if (value === 'compact' || value === 'comfortable')
                updateMobilePreferences({ threadDensity: value })
            }}
          />
        </SettingsGroup>
        <SettingsGroup
          title={uiText('Theme')}
          footer={uiText('System follows your phone’s light or dark mode.')}
        >
          <Choice
            label={uiText('Color scheme')}
            value={theme}
            items={[
              { id: 'system', name: uiText('System') },
              { id: 'light', name: uiText('Light') },
              { id: 'dark', name: uiText('Dark') },
            ]}
            onChange={(value) => {
              if (value === 'system' || value === 'light' || value === 'dark')
                updateMobilePreferences({ theme: value })
            }}
          />
        </SettingsGroup>
        <SettingsGroup
          title={uiText('Color palette')}
          footer={uiText('The same palettes as desktop, with both light and dark previews.')}
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
                  backgroundColor: selected ? colors.selection : colors.surface,
                  alignItems: 'center',
                  minHeight: 60,
                  padding: 12,
                  gap: 12,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View
                  style={{ width: 72, flexDirection: 'row', borderRadius: 6, overflow: 'hidden' }}
                >
                  <PalettePreview colors={palette.dark} />
                  <PalettePreview colors={palette.light} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={styles.text}>{palette.name}</Text>
                  <Text style={styles.muted}>{palette.description}</Text>
                </View>
                {selected && <Icon name="check" size={16} color={colors.accent} />}
              </Pressable>
            )
          })}
        </SettingsGroup>
        <CodeThemeSettings />
        <SettingsGroup
          title={uiText('Terminal')}
          footer={uiText(
            'JetBrains Mono Nerd Font is bundled for offline shell and developer icons. Changes apply to open terminals.',
          )}
        >
          <Choice
            label={uiText('Terminal font')}
            value={terminalFontFamily}
            items={[
              { id: '', name: uiText('System monospace') },
              { id: nerdFontFamily, name: nerdFontFamily },
            ]}
            onChange={(value) => {
              if (value === '' || value === nerdFontFamily)
                updateMobilePreferences({ terminalFontFamily: value })
            }}
          />
          <Choice
            label={uiText('Terminal font size')}
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
      style={{ width: '50%', height: 36, padding: 6, backgroundColor: colors.background, gap: 3 }}
    >
      <View
        style={{ height: 3, width: '80%', borderRadius: 2, backgroundColor: colors.foreground }}
      />
      <View style={{ height: 3, width: '50%', borderRadius: 2, backgroundColor: colors.primary }} />
      <View style={{ height: 3, width: '65%', borderRadius: 2, backgroundColor: colors.signal }} />
    </View>
  )
}
