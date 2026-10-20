import { useState } from 'react'
import {
  artifactPdfDefaults,
  artifactPdfOptionsSchema,
  artifactPdfPaperChoices,
  artifactPngWidthSchema,
  ARTIFACT_PNG_DEFAULT_WIDTH,
  decodeResult,
  type ArtifactPdfOptions,
} from '@dovo/protocol'
import { Button, Input } from '@dovo/studio-ui'
import { LoaderCircle, X } from 'lucide-react'

export function ArtifactExportOptions({
  busy,
  disabled,
  onPdf,
  onPng,
  onClose,
}: {
  busy: boolean
  disabled: boolean
  onPdf: (options: ArtifactPdfOptions) => void
  onPng: (width: number) => void
  onClose: () => void
}) {
  const [format, setFormat] = useState<'pdf' | 'png'>('pdf')
  const [paperSize, setPaperSize] = useState<string>(artifactPdfDefaults.paperSize)
  const [landscape, setLandscape] = useState<boolean>(artifactPdfDefaults.landscape)
  const [margin, setMargin] = useState(String(artifactPdfDefaults.marginMm))
  const [scale, setScale] = useState(String(artifactPdfDefaults.scale))
  const [background, setBackground] = useState<boolean>(artifactPdfDefaults.background)
  const [width, setWidth] = useState(String(ARTIFACT_PNG_DEFAULT_WIDTH))
  const options = decodeResult(artifactPdfOptionsSchema, {
    paperSize,
    landscape,
    marginMm: margin.trim() ? Number(margin) : NaN,
    scale: scale.trim() ? Number(scale) : NaN,
    background,
  }).data
  const pngWidth = decodeResult(artifactPngWidthSchema, width.trim() ? Number(width) : NaN).data
  const valid = format === 'pdf' ? !!options : pngWidth !== undefined
  const control = 'h-8 rounded-md border bg-background px-2 text-xs'
  return (
    <section
      aria-label="Export options"
      className="shrink-0 border-b bg-muted/20 px-4 py-3 text-xs"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1" aria-label="Export format">
          {(['pdf', 'png'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={format === value ? 'secondary' : 'ghost'}
              className="h-7 px-3 text-xs"
              aria-pressed={format === value}
              disabled={busy}
              onClick={() => setFormat(value)}
            >
              {value.toUpperCase()}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Close export options"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <fieldset disabled={busy} className="grid grid-cols-2 gap-3">
        {format === 'pdf' ? (
          <>
            <label className="flex flex-col gap-1">
              Paper size
              <select
                aria-label="Paper size"
                className={control}
                value={paperSize}
                onChange={(event) => setPaperSize(event.target.value)}
              >
                {artifactPdfPaperChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Orientation
              <select
                aria-label="Orientation"
                className={control}
                value={landscape ? 'landscape' : 'portrait'}
                onChange={(event) => setLandscape(event.target.value === 'landscape')}
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Margins (mm)
              <Input
                aria-label="Margins (mm)"
                className="h-8 text-xs"
                type="number"
                min={0}
                max={50}
                step="any"
                value={margin}
                onChange={(event) => setMargin(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              Scale (%)
              <Input
                aria-label="Scale (%)"
                className="h-8 text-xs"
                type="number"
                min={10}
                max={200}
                step="any"
                value={scale}
                onChange={(event) => setScale(event.target.value)}
              />
            </label>
            <label className="col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={background}
                onChange={(event) => setBackground(event.target.checked)}
              />
              Include backgrounds
            </label>
          </>
        ) : (
          <label className="col-span-2 flex flex-col gap-1">
            Width (px)
            <Input
              aria-label="Width (px)"
              className="h-8 text-xs"
              type="number"
              min={320}
              max={4096}
              step={1}
              value={width}
              onChange={(event) => setWidth(event.target.value)}
            />
          </label>
        )}
      </fieldset>
      <p className="mt-2 text-muted-foreground">
        {format === 'pdf'
          ? paperSize === 'auto'
            ? 'Automatic keeps any page size and orientation defined by the artifact. A4 is the fallback.'
            : 'Print layout with your selected page size and orientation.'
          : 'Full page at this width. Height adjusts to the content.'}
      </p>
      {!valid && (
        <p role="alert" className="mt-2 text-destructive">
          {format === 'pdf'
            ? 'Enter margins from 0–50 mm and a scale from 10–200%.'
            : 'Enter a whole width from 320–4096 px.'}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Selected saved version</span>
        <Button
          size="sm"
          className="h-8 gap-2 text-xs"
          disabled={disabled || busy || !valid}
          onClick={() => {
            if (format === 'pdf' && options) onPdf(options)
            if (format === 'png' && pngWidth !== undefined) onPng(pngWidth)
          }}
        >
          {busy && <LoaderCircle className="size-3 animate-spin" />}
          {busy ? 'Exporting…' : `Export ${format.toUpperCase()}`}
        </Button>
      </div>
    </section>
  )
}
