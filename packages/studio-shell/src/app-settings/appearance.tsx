import {
  studioThemeIds,
  studioThemes,
  updateAppPreferences,
  useAppPreferences,
  type StudioThemeColors,
} from '@dovo/studio-core'
import { SettingRow, SettingsGroup, SettingsPage, Segmented } from './layout'

export default function AppearanceSettings() {
  const { theme, themePalette, textSize, motion, chatWidth } = useAppPreferences()
  return (
    <SettingsPage local title="Appearance" description="How Dovo looks on this device.">
      <SettingsGroup title="Theme">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="min-w-48 flex-1">
            <p className="text-[0.8125rem] font-medium">Color scheme</p>
            <p className="mt-1 text-xs text-muted-foreground">
              System follows your computer’s light or dark mode.
            </p>
          </div>
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
        </div>
        <fieldset className="min-w-0 p-4">
          <legend className="sr-only">Color palette</legend>
          <p className="mb-3 text-xs text-muted-foreground">
            Every palette includes a dark and light mode. Dovo uses our signature graphite and blue.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {studioThemeIds.map((id) => {
              const palette = studioThemes[id]
              return (
                <label
                  key={id}
                  className={`relative min-w-0 cursor-pointer rounded-lg border p-2.5 focus-within:ring-2 focus-within:ring-ring ${themePalette === id ? 'border-primary bg-accent' : 'bg-background hover:border-muted-foreground'}`}
                >
                  <input
                    type="radio"
                    name="theme-palette"
                    value={id}
                    aria-label={palette.name}
                    checked={themePalette === id}
                    onChange={() => updateAppPreferences({ themePalette: id })}
                    className="sr-only"
                  />
                  <span className="mb-2 flex overflow-hidden rounded border" aria-hidden="true">
                    <PalettePreview colors={palette.dark} />
                    <PalettePreview colors={palette.light} />
                  </span>
                  <span className="flex items-center justify-between gap-1 text-xs font-medium">
                    {palette.name}
                    {id === 'dovo' && (
                      <span className="text-[10px] text-muted-foreground">Default</span>
                    )}
                  </span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {palette.description}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
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
      <SettingsGroup title="Conversation">
        <SettingRow label="Chat width" description="How wide conversations grow on large screens.">
          <Segmented
            label="Chat width"
            value={chatWidth}
            options={[
              ['standard', 'Standard'],
              ['wide', 'Wide'],
              ['full', 'Full width'],
            ]}
            onChange={(chatWidth) => updateAppPreferences({ chatWidth })}
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

function PalettePreview({ colors }: { colors: StudioThemeColors }) {
  return (
    <span className="flex h-10 w-1/2 gap-1.5 p-1.5" style={{ background: colors.background }}>
      <span
        className="w-3 rounded-sm"
        style={{ background: colors.sidebar, border: `1px solid ${colors.border}` }}
      />
      <span className="flex flex-1 flex-col justify-center gap-1">
        <span className="h-1 w-3/4 rounded-full" style={{ background: colors.foreground }} />
        <span className="h-1 w-1/2 rounded-full" style={{ background: colors.primary }} />
        <span className="h-1 w-2/3 rounded-full" style={{ background: colors.signal }} />
      </span>
      <span className="mt-auto size-2 rounded-full" style={{ background: colors.action }} />
    </span>
  )
}
