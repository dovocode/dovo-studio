import type { ReactNode } from 'react'
import type { StudioThemeId, StudioThemeMode } from '@dovo/studio-core/themes'
import { createMobileTheme, MobileThemeContext } from '../../mobile/src/ui/theme'
import { MobileCatalogProviders } from '../../mobile/src/catalog/providers'

export function MobilePreview({
  children,
  palette = 'dovo',
  mode = 'dark',
  width = 390,
  label = 'Mobile component preview',
}: {
  children: ReactNode
  palette?: StudioThemeId
  mode?: StudioThemeMode
  width?: number
  label?: string
}) {
  const theme = createMobileTheme(palette, mode)
  return (
    <MobileCatalogProviders>
      <MobileThemeContext.Provider value={theme}>
        <div
          style={{
            maxWidth: '100%',
            width,
            minHeight: 360,
            alignSelf: 'center',
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 20,
            backgroundColor: theme.colors.background,
          }}
        >
          <div style={{ minHeight: '100%', overflowY: 'auto' }}>{children}</div>
        </div>
        <p
          role="note"
          style={{
            maxWidth: 520,
            alignSelf: 'center',
            marginTop: 10,
            color: theme.colors.muted,
            fontSize: 12,
            textAlign: 'center',
          }}
        >
          {label} · Rendered with React Native Web; native platform chrome, gesture arbitration, and
          native-only controls are not represented.
        </p>
      </MobileThemeContext.Provider>
    </MobileCatalogProviders>
  )
}
