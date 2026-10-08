import {
  fontStack,
  systemMonoFont,
  nerdFontFamily,
  studioThemeIds,
  studioThemes,
  updateAppPreferences,
  useAppPreferences,
  type StudioThemeColors,
} from '@dovo/studio-core'
import { ChoicePicker, Input } from '@dovo/studio-ui'
import { SettingRow, SettingsGroup, SettingsPage, Segmented } from './layout'

export default function AppearanceSettings() {
  const {
    theme,
    themePalette,
    textSize,
    motion,
    chatWidth,
    appFontFamily,
    codeFontFamily,
    terminalFontFamily,
    terminalFontSize,
  } = useAppPreferences()
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
      <datalist id="app-fonts">
        {['system-ui', 'Arial', 'Helvetica Neue', 'Georgia', 'serif'].map((font) => (
          <option key={font} value={font} />
        ))}
      </datalist>
      <datalist id="mono-fonts">
        {[
          nerdFontFamily,
          'SF Mono',
          'Menlo',
          'Consolas',
          'Cascadia Code',
          'Fira Code',
          'monospace',
        ].map((font) => (
          <option key={font} value={font} />
        ))}
      </datalist>
      <SettingsGroup title="Text">
        <SettingRow
          label="App font"
          description="Choose a font or enter an installed font’s family name. Leave empty for the default."
        >
          <Input
            aria-label="App font"
            list="app-fonts"
            placeholder="Default"
            value={appFontFamily}
            maxLength={100}
            onChange={(event) => updateAppPreferences({ appFontFamily: event.target.value })}
          />
        </SettingRow>
        <SettingRow
          label="Code font"
          description="Used in code blocks and diffs. JetBrains Mono Nerd Font is bundled; other fonts need to be installed on this device."
        >
          <Input
            aria-label="Code font"
            list="mono-fonts"
            placeholder="System monospace"
            value={codeFontFamily}
            maxLength={100}
            onChange={(event) => updateAppPreferences({ codeFontFamily: event.target.value })}
          />
        </SettingRow>
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
      <SettingsGroup
        title="Terminal"
        description="Changes apply to open terminals without restarting them."
      >
        <SettingRow
          label="Terminal font"
          description="JetBrains Mono Nerd Font includes shell and developer icons and works offline. Leave empty for system monospace."
        >
          <Input
            aria-label="Terminal font"
            list="mono-fonts"
            placeholder="System monospace"
            value={terminalFontFamily}
            maxLength={100}
            onChange={(event) => updateAppPreferences({ terminalFontFamily: event.target.value })}
          />
        </SettingRow>
        <SettingRow label="Terminal font size" description="In pixels, from 8 to 32.">
          <ChoicePicker
            aria-label="Terminal font size"
            value={String(terminalFontSize)}
            onValueChange={(value) => updateAppPreferences({ terminalFontSize: Number(value) })}
          >
            {Array.from({ length: 25 }, (_, index) => (
              <option key={index + 8} value={String(index + 8)}>
                {index + 8} px
              </option>
            ))}
          </ChoicePicker>
        </SettingRow>
        <div
          className="overflow-x-auto px-4 py-4 text-sm"
          aria-label="Terminal font preview"
          style={{
            fontFamily: fontStack(terminalFontFamily, systemMonoFont),
            fontSize: terminalFontSize,
          }}
        >
          <span aria-hidden="true">{'❯ ~ git status  \ue0a0 main  \uf07b src  \uf121 code'}</span>
        </div>
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
