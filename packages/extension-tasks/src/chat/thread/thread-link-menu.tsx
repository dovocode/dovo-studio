import { useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { ContextMenu } from '@dovo/studio-ui'
import { threadPullLink } from '@dovo/protocol'
import { useStudioHost } from '@dovo/studio-core'

const itemClass =
  'cursor-default rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50'

export function ThreadLinkMenu({
  children,
  onBrowser,
  onPullLink,
  onLinkPull,
  linked,
}: {
  children: ReactNode
  onBrowser?: (url: string) => void
  onPullLink: (url: string) => boolean
  onLinkPull?: (url: string) => void
  linked: (url: string) => boolean
}) {
  const { openExternalLink } = useStudioHost()
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const pull = threadPullLink(url)
  const perform = (action: () => Promise<void>) => {
    void action().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    )
  }
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild disabled={!url}>
        <div
          className="flex min-h-0 flex-1 flex-col"
          onContextMenuCapture={(event) => {
            const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
            if (!(anchor instanceof HTMLAnchorElement) || !/^https?:\/\//i.test(anchor.href)) {
              flushSync(() => setUrl(''))
              return
            }
            // Enable Radix before the bubbling handler, leaving other context menus intact.
            flushSync(() => {
              setUrl(anchor.href)
              setError('')
            })
          }}
        >
          {children}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="z-[100] min-w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
          collisionPadding={8}
        >
          {pull && (
            <ContextMenu.Item
              className={itemClass}
              onSelect={() => {
                if (!onPullLink(pull.url)) onBrowser?.(pull.url)
              }}
            >
              Open PR details
            </ContextMenu.Item>
          )}
          {onBrowser && (
            <ContextMenu.Item className={itemClass} onSelect={() => onBrowser(url)}>
              Open in Dovo browser
            </ContextMenu.Item>
          )}
          <ContextMenu.Item
            className={itemClass}
            onSelect={() => {
              if (openExternalLink) perform(() => openExternalLink(url))
              else window.open(url, '_blank', 'noopener,noreferrer')
            }}
          >
            Open in default browser
          </ContextMenu.Item>
          <ContextMenu.Item
            className={itemClass}
            onSelect={() => perform(() => navigator.clipboard.writeText(url))}
          >
            Copy link
          </ContextMenu.Item>
          {pull && onLinkPull && (
            <>
              <ContextMenu.Separator className="my-1 h-px bg-border" />
              <ContextMenu.Item
                className={itemClass}
                disabled={linked(url)}
                onSelect={() => onLinkPull(url)}
              >
                {linked(url) ? 'Already linked to this thread' : 'Link to this thread'}
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
      {error && (
        <p role="alert" className="px-3 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </ContextMenu.Root>
  )
}
