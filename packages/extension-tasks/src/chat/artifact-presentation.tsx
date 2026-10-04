import { AppWindow, CodeXml, FileText, Shapes } from 'lucide-react'
import type { ArtifactReference } from '@dovo/protocol'
import { cn } from '@dovo/studio-ui'

const presentation = {
  markdown: {
    icon: FileText,
    tone: 'text-amber-600 dark:text-amber-300',
    canvas: 'bg-amber-500/5',
  },
  html: { icon: AppWindow, tone: 'text-blue-600 dark:text-blue-300', canvas: 'bg-blue-500/5' },
  svg: { icon: Shapes, tone: 'text-violet-600 dark:text-violet-300', canvas: 'bg-violet-500/5' },
  code: {
    icon: CodeXml,
    tone: 'text-emerald-600 dark:text-emerald-300',
    canvas: 'bg-emerald-500/5',
  },
}

export function ArtifactIcon({
  format,
  className,
}: {
  format: ArtifactReference['format']
  className?: string
}) {
  const { icon: Icon, tone } = presentation[format]
  return <Icon aria-hidden="true" strokeWidth={1.5} className={cn('size-5', tone, className)} />
}

/** Format illustrations keep library browsing fast without fetching or running artifact bodies. */
export function ArtifactThumbnail({ format }: { format: ArtifactReference['format'] }) {
  const { canvas, tone } = presentation[format]
  return (
    <div
      aria-hidden="true"
      className={cn('flex h-36 items-center justify-center overflow-hidden border-b', canvas, tone)}
    >
      {format === 'markdown' ? (
        <div className="mt-10 w-32 -rotate-6 rounded-t-lg border border-current/15 bg-background p-5 shadow-sm transition-transform group-hover:rotate-0">
          <FileText className="mb-5 size-6" strokeWidth={1.4} />
          <div className="space-y-2">
            <div className="h-1.5 w-12 rounded bg-current/30" />
            <div className="h-1 w-full rounded bg-current/15" />
            <div className="h-1 w-4/5 rounded bg-current/15" />
            <div className="h-1 w-full rounded bg-current/15" />
          </div>
        </div>
      ) : format === 'html' ? (
        <div className="w-44 overflow-hidden rounded-lg border border-current/15 bg-background shadow-sm transition-transform group-hover:-translate-y-1">
          <div className="flex gap-1 border-b border-current/10 p-2.5">
            {[0, 1, 2].map((index) => (
              <span key={index} className="size-1.5 rounded-full bg-current/25" />
            ))}
          </div>
          <div className="flex items-center gap-3 p-4">
            <div className="flex size-12 items-center justify-center rounded-lg bg-current/5">
              <AppWindow className="size-6" strokeWidth={1.4} />
            </div>
            <div className="flex-1 space-y-2">
              <div className="h-1.5 w-4/5 rounded bg-current/30" />
              <div className="h-1 w-full rounded bg-current/15" />
              <div className="h-1 w-3/5 rounded bg-current/15" />
            </div>
          </div>
        </div>
      ) : format === 'svg' ? (
        <Shapes className="size-20 transition-transform group-hover:rotate-6" strokeWidth={0.8} />
      ) : (
        <div className="flex items-center gap-4 transition-transform group-hover:-translate-y-1">
          <CodeXml className="size-12" strokeWidth={1.1} />
          <div className="space-y-2.5">
            <div className="h-1.5 w-16 rounded bg-current/25" />
            <div className="ml-3 h-1.5 w-20 rounded bg-current/15" />
            <div className="ml-3 h-1.5 w-12 rounded bg-current/15" />
            <div className="h-1.5 w-10 rounded bg-current/25" />
          </div>
        </div>
      )}
    </div>
  )
}
