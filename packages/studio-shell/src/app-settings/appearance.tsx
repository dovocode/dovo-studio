import {
  fontStack,
  systemAppFont,
  systemMonoFont,
  nerdFontFamily,
  studioThemeIds,
  studioThemes,
  updateAppPreferences,
  useAppPreferences,
  type StudioThemeColors,
} from '@dovo/studio-core'
import { Check, CircleCheck, CircleX, MessageCircleQuestion, Minus, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { Button, Disclosure, Input } from '@dovo/studio-ui'
import { SettingRow, SettingsGroup, SettingsPage, Toggle } from './layout'
import { SettingsSelect } from './settings-select'
import { CodeThemeSettings } from './code-theme'

export default function AppearanceSettings() {
  const {
    theme,
    themePalette,
    themeGlow,
    themeGradients,
    textSize,
    motion,
    highContrast,
    colorVision,
    chatWidth,
    appFontFamily,
    codeFontFamily,
    terminalFontFamily,
    terminalFontSize,
  } = useAppPreferences()
  const terminalSizeId = useId()
  const [terminalSizeInput, setTerminalSizeInput] = useState<string | null>(null)
  const invalidTerminalSize =
    terminalSizeInput !== null &&
    (!/^\d+$/.test(terminalSizeInput) ||
      Number(terminalSizeInput) < 8 ||
      Number(terminalSizeInput) > 32)
  function stepTerminalFontSize(step: number) {
    setTerminalSizeInput(null)
    updateAppPreferences({ terminalFontSize: terminalFontSize + step })
  }
  const selectedPalette = studioThemes[themePalette]
  return (
    <SettingsPage local title="Appearance" description="How Dovo looks on this device.">
      <SettingsGroup
        title="Theme"
        description="Choose your scheme and palette, then fine-tune the highlights."
      >
        <SettingRow
          label="Color scheme"
          description="System follows your computer’s light or dark mode."
        >
          <SettingsSelect
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
        <SettingRow
          label="Color palette"
          description={`${selectedPalette.name} · ${selectedPalette.description}`}
        >
          <span
            role="img"
            aria-label={`Current color palette: ${selectedPalette.name}`}
            className="flex w-full overflow-hidden rounded-md border"
          >
            <PalettePreview colors={selectedPalette.dark} />
            <PalettePreview colors={selectedPalette.light} />
          </span>
        </SettingRow>
        <Disclosure
          title="Browse palettes"
          data-setting-label="Color palette choices"
          className="pb-3"
        >
          <fieldset className="min-w-0">
            <legend className="sr-only">Color palette</legend>
            <p className="mb-3 text-xs text-muted-foreground">
              Each palette includes light and dark colors.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {studioThemeIds.map((id) => {
                const palette = studioThemes[id]
                return (
                  <label
                    key={id}
                    className={`relative min-w-0 cursor-pointer rounded-lg border p-2.5 focus-within:ring-2 focus-within:ring-ring ${themePalette === id ? 'border-primary outline-1 outline-offset-1 outline-primary/60 bg-[var(--studio-selected-fill)] [background-image:var(--studio-selected-gradient)] [box-shadow:var(--studio-glow)]' : 'border-border/60 bg-background/60 hover:border-muted-foreground/60 hover:bg-muted/50'}`}
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
                    <span
                      className="mb-2 flex overflow-hidden rounded-md border"
                      aria-hidden="true"
                    >
                      <PalettePreview colors={palette.dark} />
                      <PalettePreview colors={palette.light} />
                    </span>
                    <span className="flex items-center justify-between gap-1 text-xs font-medium">
                      {palette.name}
                      <span className="ml-auto inline-flex shrink-0 items-center gap-1.5">
                        {themePalette === id && (
                          <>
                            <span className="text-[10px] font-normal">Selected</span>
                            <Check className="size-3.5" aria-hidden="true" />
                          </>
                        )}
                      </span>
                    </span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                      {palette.description}
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>
        </Disclosure>
        <SettingRow
          label="Glow"
          description="A soft theme-colored glow around highlighted controls. Off removes the glow."
        >
          <div className="flex w-full items-center gap-3">
            <input
              type="range"
              aria-label="Glow intensity"
              min={0}
              max={1}
              step={0.05}
              value={themeGlow}
              aria-valuetext={themeGlow === 0 ? 'Off' : `${Math.round(themeGlow * 100)} percent`}
              onChange={(event) =>
                updateAppPreferences({ themeGlow: event.currentTarget.valueAsNumber })
              }
              className="h-5 min-w-0 flex-1 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            <output className="w-10 shrink-0 text-right text-xs tabular-nums" aria-hidden="true">
              {themeGlow === 0 ? 'Off' : `${Math.round(themeGlow * 100)}%`}
            </output>
          </div>
        </SettingRow>
        <SettingRow
          label="Gradients"
          description="Use gradient highlights on buttons and surfaces."
        >
          <Toggle
            label="Gradients"
            checked={themeGradients}
            onChange={(themeGradients) => updateAppPreferences({ themeGradients })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup
        title="Accessibility"
        description="Status icons and labels remain visible in every color mode."
      >
        <SettingRow
          label="Status colors"
          description={
            <>
              Normal colors or GitHub’s colorblind palette for statuses and diffs.
              <span
                role="group"
                className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs"
                aria-label="Status color preview"
              >
                <span className="inline-flex items-center gap-1 text-status-success">
                  <CircleCheck className="size-3.5" aria-hidden="true" />
                  Finished
                </span>
                <span className="inline-flex items-center gap-1 text-status-error">
                  <CircleX className="size-3.5" aria-hidden="true" />
                  Failed
                </span>
                <span className="inline-flex items-center gap-1 text-status-warning">
                  <MessageCircleQuestion className="size-3.5" aria-hidden="true" />
                  Needs input
                </span>
              </span>
            </>
          }
        >
          <SettingsSelect
            label="Status colors"
            value={colorVision}
            options={[
              ['default', 'Normal'],
              ['blue-orange', 'GitHub colorblind'],
            ]}
            onChange={(colorVision) => updateAppPreferences({ colorVision })}
          />
        </SettingRow>
        <SettingRow
          label="Higher contrast"
          description="Stronger text, borders, controls and status colors with neutral surfaces."
        >
          <Toggle
            label="Higher contrast"
            checked={highContrast}
            onChange={(highContrast) => updateAppPreferences({ highContrast })}
          />
        </SettingRow>
        <SettingRow
          label="Animations"
          description="System follows your computer’s Reduce motion setting, including conversation scrolling."
        >
          <SettingsSelect
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
      <CodeThemeSettings />
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
          description="Enter an installed font’s family name, or choose a suggestion. Empty uses the default."
        >
          <Input
            aria-label="App font"
            className="w-full"
            list="app-fonts"
            placeholder="Default"
            value={appFontFamily}
            maxLength={100}
            onChange={(event) => updateAppPreferences({ appFontFamily: event.target.value })}
          />
        </SettingRow>
        <SettingRow
          label="Code font"
          description="For code blocks and diffs. JetBrains Mono Nerd Font is included; other fonts must be installed."
        >
          <Input
            aria-label="Code font"
            className="w-full"
            list="mono-fonts"
            placeholder="System monospace"
            value={codeFontFamily}
            maxLength={100}
            onChange={(event) => updateAppPreferences({ codeFontFamily: event.target.value })}
          />
        </SettingRow>
        <SettingRow label="Text size" description="Scales text and spacing across the app.">
          <SettingsSelect
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
        <div
          role="group"
          aria-label="Font previews"
          className="grid min-w-0 gap-3 py-3 sm:grid-cols-2"
        >
          <div className="min-w-0 rounded-lg border bg-background/50 p-3">
            <p className="mb-2 text-[11px] font-medium text-muted-foreground">App font preview</p>
            <p
              className="break-words text-sm leading-relaxed"
              style={{ fontFamily: fontStack(appFontFamily, systemAppFont) }}
            >
              A clear view of your next idea.
            </p>
          </div>
          <div className="min-w-0 rounded-lg border bg-background/50 p-3">
            <p className="mb-2 text-[11px] font-medium text-muted-foreground">Code font preview</p>
            <code
              className="block break-words text-xs leading-relaxed"
              style={{ fontFamily: fontStack(codeFontFamily, systemMonoFont) }}
            >
              {'const message = "Hello, Dovo";'}
            </code>
          </div>
        </div>
      </SettingsGroup>
      <SettingsGroup
        title="Terminal"
        description="Changes apply to open terminals without restarting them."
      >
        <SettingRow
          label="Terminal font"
          description="JetBrains Mono Nerd Font includes developer icons. Empty uses system monospace."
        >
          <Input
            aria-label="Terminal font"
            className="w-full"
            list="mono-fonts"
            placeholder="System monospace"
            value={terminalFontFamily}
            maxLength={100}
            onChange={(event) => updateAppPreferences({ terminalFontFamily: event.target.value })}
          />
        </SettingRow>
        <SettingRow
          label="Terminal font size"
          description="Whole pixels, from 8 to 32. Invalid or empty entries revert when you leave the field."
        >
          <div className="w-full space-y-1.5">
            <div className="flex w-full items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                aria-label="Decrease terminal font size"
                disabled={terminalFontSize <= 8}
                onClick={() => stepTerminalFontSize(-1)}
              >
                <Minus className="size-4" aria-hidden="true" />
              </Button>
              <Input
                aria-label="Terminal font size"
                aria-invalid={invalidTerminalSize}
                aria-describedby={invalidTerminalSize ? `${terminalSizeId}-error` : undefined}
                type="number"
                min={8}
                max={32}
                step={1}
                className="studio-terminal-size-input min-w-0 flex-1 text-center tabular-nums"
                value={terminalSizeInput ?? String(terminalFontSize)}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setTerminalSizeInput(value)
                  const size = Number(value)
                  if (/^\d+$/.test(value) && size >= 8 && size <= 32)
                    updateAppPreferences({ terminalFontSize: size })
                }}
                onBlur={() => setTerminalSizeInput(null)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === 'Escape') {
                    event.preventDefault()
                    setTerminalSizeInput(null)
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                aria-label="Increase terminal font size"
                disabled={terminalFontSize >= 32}
                onClick={() => stepTerminalFontSize(1)}
              >
                <Plus className="size-4" aria-hidden="true" />
              </Button>
            </div>
            {invalidTerminalSize && (
              <p id={`${terminalSizeId}-error`} className="text-xs text-destructive">
                Enter a whole number from 8 to 32.
              </p>
            )}
          </div>
        </SettingRow>
        <div
          className="my-3 overflow-x-auto rounded-lg border bg-background/50 px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          role="region"
          tabIndex={0}
          aria-label="Terminal font preview"
        >
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">
            Terminal preview · {terminalFontSize} px
          </p>
          <p
            className="w-max leading-relaxed"
            style={{
              fontFamily: fontStack(terminalFontFamily, systemMonoFont),
              fontSize: terminalFontSize,
            }}
            aria-hidden="true"
          >
            {terminalFontFamily === nerdFontFamily
              ? '❯ ~ git status  \ue0a0 main  \uf07b src  \uf121 code'
              : '$ git status · main · src · code'}
          </p>
        </div>
      </SettingsGroup>
      <SettingsGroup title="Conversation">
        <SettingRow label="Chat width" description="How wide conversations grow on large screens.">
          <SettingsSelect
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
    </SettingsPage>
  )
}

function PalettePreview({ colors }: { colors: StudioThemeColors }) {
  return (
    <span className="flex h-8 w-1/2 gap-1.5 p-1.5" style={{ background: colors.background }}>
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
