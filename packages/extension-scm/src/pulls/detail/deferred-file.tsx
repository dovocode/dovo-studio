import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PullDetail } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'

/** Mount expensive diffs near the viewport, then retain them to preserve comment drafts. */
export function DeferredPullFile({
  file,
  selected,
  children,
}: {
  file: PullDetail['files'][number]
  selected: boolean
  children: ReactNode
}) {
  const container = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const reason = file.attributes?.generated
    ? 'Generated file'
    : file.attributes?.vendored
      ? 'Vendored file'
      : ''
  const collapsed = !!reason && !(expanded ?? false)
  useEffect(() => {
    if (mounted || collapsed) return
    if (selected || typeof IntersectionObserver === 'undefined') {
      setMounted(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setMounted(true)
          observer.disconnect()
        }
      },
      { rootMargin: '600px 0px' },
    )
    if (container.current) observer.observe(container.current)
    return () => observer.disconnect()
  }, [mounted, collapsed, selected])
  return (
    <div ref={container}>
      {reason && (
        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <span>{reason} · marked in .gitattributes</span>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={!collapsed}
            onClick={() => {
              setExpanded(collapsed)
              if (collapsed) setMounted(true)
            }}
          >
            {collapsed ? 'Show changes' : 'Hide changes'}
          </Button>
        </div>
      )}
      {mounted ? (
        <div hidden={collapsed}>{children}</div>
      ) : !collapsed ? (
        <div className="flex min-h-40 items-center justify-center py-4">
          <Button size="sm" variant="ghost" onClick={() => setMounted(true)}>
            Load changes for {file.path}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
