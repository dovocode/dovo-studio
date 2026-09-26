import { updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { SettingRow, SettingsGroup, SettingsPage, Segmented } from './layout'

export default function AppearanceSettings() {
  const { theme, textSize, motion } = useAppPreferences()
  return (
    <SettingsPage title="Appearance" description="How Dovo looks on this device.">
      <SettingsGroup title="Theme">
        <SettingRow
          label="Color scheme"
          description="System follows your computer’s light or dark mode."
        >
          <Segmented
            label="Color scheme"
            value={theme}
            options={[
              ['dark', 'Dark'],
              ['light', 'Light'],
              ['system', 'System'],
            ]}
            onChange={(theme) => updateAppPreferences({ theme })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Text">
        <SettingRow label="Text size" description="Scales text and spacing across the app.">
          <Segmented
            label="Text size"
            value={textSize}
            options={[
              ['small', 'Small'],
              ['default', 'Default'],
              ['large', 'Large'],
            ]}
            onChange={(textSize) => updateAppPreferences({ textSize })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Motion">
        <SettingRow
          label="Animations"
          description="System follows your computer’s Reduce motion setting."
        >
          <Segmented
            label="Animations"
            value={motion}
            options={[
              ['system', 'System'],
              ['reduce', 'Reduce'],
            ]}
            onChange={(motion) => updateAppPreferences({ motion })}
          />
        </SettingRow>
      </SettingsGroup>
    </SettingsPage>
  )
}
