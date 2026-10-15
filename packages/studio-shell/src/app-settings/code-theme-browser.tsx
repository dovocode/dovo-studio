import { useState } from 'react'
import { ArrowLeft, ExternalLink, Search } from 'lucide-react'
import { nativeCodeColors, type ImportedCodeTheme } from '@dovo/studio-core/code-themes'
import { themeCatalogUrl, useCodeThemeCatalog } from '@dovo/studio-core/theme-catalog'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from '@dovo/studio-ui'

export function CodeThemeBrowser({
  onClose,
  onImport,
}: {
  onClose: () => void
  onImport: (theme: ImportedCodeTheme) => void
}) {
  const catalog = useCodeThemeCatalog()
  const [error, setError] = useState('')
  const importTheme = (theme: ImportedCodeTheme) => {
    try {
      onImport(theme)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-2xl">
        <DialogTitle>Browse VS Code themes</DialogTitle>
        <DialogDescription>
          From{' '}
          <a
            href="https://open-vsx.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Open VSX
          </a>
          , the public registry for VS Code-compatible extensions. Import colors only; extension
          code is never installed.
        </DialogDescription>
        {catalog.selected ? (
          <div className="min-h-0 overflow-y-auto space-y-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                catalog.select()
                setError('')
              }}
            >
              <ArrowLeft />
              Back to themes
            </Button>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold break-words">
                {catalog.selected.displayName ?? catalog.selected.name}
              </h3>
              <p className="text-sm text-muted-foreground break-words">
                {catalog.selected.namespace}.{catalog.selected.name} · {catalog.selected.version}
              </p>
              <p className="text-sm text-muted-foreground">{catalog.selected.description}</p>
              <a
                href={themeCatalogUrl(catalog.selected)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm underline"
              >
                View on Open VSX <ExternalLink className="size-3" />
              </a>
            </div>
            {!catalog.bundle && !catalog.bundleError && (
              <p role="status" className="text-sm text-muted-foreground">
                Downloading theme previews…
              </p>
            )}
            {catalog.bundleError && (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive">
                  {catalog.bundleError}
                </p>
                <Button variant="outline" size="sm" onClick={catalog.retryBundle}>
                  Retry download
                </Button>
              </div>
            )}
            {catalog.bundle?.themes.map((theme) => {
              const colors = nativeCodeColors(theme)
              return (
                <div key={theme.name} className="overflow-hidden rounded-xl border">
                  <div className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="font-medium break-words">{theme.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {theme.type === 'dark' ? 'Dark' : 'Light'}
                        {theme.source?.license ? ` · ${theme.source.license}` : ''}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      aria-label={`Import ${theme.label}`}
                      onClick={() => importTheme(theme)}
                    >
                      Import
                    </Button>
                  </div>
                  <pre
                    aria-label={`${theme.label} preview`}
                    className="overflow-x-auto p-4 text-xs leading-6"
                    style={{ background: colors.background, color: colors.text }}
                  >
                    <span style={{ color: colors.comment }}>// Editor & diff preview</span>
                    {'\n'}
                    <span style={{ color: colors.keyword }}>const</span>{' '}
                    <span style={{ color: colors.function }}>greet</span>
                    {' = ('}
                    <span style={{ color: colors.type }}>name</span>
                    {') => '}
                    <span style={{ color: colors.string }}>"Hello "</span>
                    {' + name;\n'}
                    <span style={{ color: colors.function }}>greet</span>
                    {'('}
                    <span style={{ color: colors.string }}>"Dovo"</span>
                    {');'}
                  </pre>
                </div>
              )
            })}
            {catalog.bundle?.warnings.map((warning, index) => (
              <p key={index} className="text-xs text-muted-foreground">
                {warning}
              </p>
            ))}
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute top-1/2 left-3 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                autoFocus
                aria-label="Search VS Code themes"
                placeholder="Search themes or publishers…"
                value={catalog.query}
                onChange={(event) => catalog.setQuery(event.target.value)}
                className="pl-9"
              />
            </div>
            <div className="min-h-0 overflow-y-auto space-y-1">
              {catalog.page?.extensions.map((extension) => (
                <button
                  type="button"
                  key={`${extension.namespace}.${extension.name}`}
                  onClick={() => catalog.select(extension)}
                  className="w-full rounded-lg p-3 text-left hover:bg-muted focus-visible:outline-ring focus-visible:outline-2"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium break-words">
                      {extension.displayName ?? extension.name}
                    </span>
                    {extension.downloadCount !== undefined && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {extension.downloadCount.toLocaleString()} downloads
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground break-words">
                    {extension.namespace}.{extension.name}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {extension.description}
                  </p>
                </button>
              ))}
              {catalog.loading && (
                <p role="status" className="p-3 text-sm text-muted-foreground">
                  Loading themes…
                </p>
              )}
              {catalog.error && (
                <div className="space-y-2 p-3">
                  <p role="alert" className="text-sm text-destructive">
                    {catalog.error}
                  </p>
                  <Button variant="outline" size="sm" onClick={catalog.retry}>
                    Retry search
                  </Button>
                </div>
              )}
              {!catalog.loading && !catalog.error && catalog.page?.extensions.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">
                  No code themes found. Try another name.
                </p>
              )}
              {!catalog.loading &&
                !catalog.error &&
                catalog.page &&
                catalog.page.offset + 20 < catalog.page.totalSize && (
                  <Button variant="outline" size="sm" onClick={catalog.more}>
                    Load more themes
                  </Button>
                )}
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
