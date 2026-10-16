import { useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { LinkOptions } from '@dovo/studio-core/links'
import { ContextMenu } from '@dovo/studio-ui'
import { threadPullLink } from '@dovo/protocol'
import { useStudioHost } from '@dovo/studio-core'
import type { Task } from '@dovo/studio-core'

const itemClass =
  'cursor-default rounded px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50'

export function ThreadLinkMenu({
  children,
  onBrowser,
  onDetails,
  runtimeId,
  onLinkPull,
  linked,
  task,
  onSearch,
  onCopyThread,
  copying = false,
  onManagePulls,
  onBookmark,
  canBookmark,
}: {
  children: ReactNode
  onBrowser?: (url: string) => void
  onDetails?: LinkOptions['details']
  runtimeId?: string
  onLinkPull?: (url: string) => void
  linked: (url: string) => boolean
  task: Pick<Task, 'id' | 'messages'> & { repositoryId?: string }
  onSearch: () => void
  onCopyThread: () => Promise<void>
  copying?: boolean
  onManagePulls?: () => void
  onBookmark: (id: string, bookmarked: boolean) => Promise<void>
  canBookmark: (id: string) => boolean
}) {
  const { getLinkActions } = useStudioHost()
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [selection, setSelection] = useState('')
  const [messageId, setMessageId] = useState('')
  const message = task.messages.find((item) => item.id === messageId)
  const pull = threadPullLink(url)
  const actions = url
    ? (getLinkActions?.(url, {
        origin: { runtimeId, repositoryId: task.repositoryId },
        details: onDetails,
        browser: onBrowser,
      }) ?? [])
    : []
  const perform = (action: () => unknown) => {
    void Promise.resolve()
      .then(action)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          className="flex min-h-0 flex-1 flex-col"
          onContextMenuCapture={(event) => {
            const target = event.target instanceof Element ? event.target : null
            const anchor = target?.closest('a[href]')
            const element = target?.closest('[id^="message-"]')
            flushSync(() => {
              setUrl(
                anchor instanceof HTMLAnchorElement && /^https?:\/\//i.test(anchor.href)
                  ? anchor.href
                  : '',
              )
              setSelection(window.getSelection()?.toString() ?? '')
              setMessageId(
                task.messages.find((item) => element?.id === `message-${task.id}-${item.id}`)?.id ??
                  '',
              )
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
          {actions.map((action) => (
            <ContextMenu.Item
              key={action.id}
              className={itemClass}
              disabled={action.disabled}
              onSelect={() => perform(action.run)}
            >
              {action.label}
            </ContextMenu.Item>
          ))}
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
          {url && <ContextMenu.Separator className="my-1 h-px bg-border" />}
          {selection && (
            <ContextMenu.Item
              className={itemClass}
              onSelect={() => perform(() => navigator.clipboard.writeText(selection))}
            >
              Copy selected text
            </ContextMenu.Item>
          )}
          {message && (
            <>
              <ContextMenu.Item
                className={itemClass}
                disabled={!message.text}
                onSelect={() => perform(() => navigator.clipboard.writeText(message.text))}
              >
                Copy message
              </ContextMenu.Item>
              {message.role === 'assistant' && (
                <ContextMenu.Item
                  className={itemClass}
                  disabled={!canBookmark(message.id)}
                  onSelect={() => perform(() => onBookmark(message.id, !message.bookmarked))}
                >
                  {message.bookmarked ? 'Remove bookmark' : 'Bookmark reply'}
                </ContextMenu.Item>
              )}
              <ContextMenu.Separator className="my-1 h-px bg-border" />
            </>
          )}
          <ContextMenu.Item
            className={itemClass}
            disabled={copying}
            onSelect={() => perform(onCopyThread)}
          >
            {copying ? 'Copying conversation…' : 'Copy conversation'}
          </ContextMenu.Item>
          <ContextMenu.Item className={itemClass} onSelect={onSearch}>
            Find in thread
          </ContextMenu.Item>
          {onManagePulls && (
            <ContextMenu.Item className={itemClass} onSelect={onManagePulls}>
              Manage linked pull requests
            </ContextMenu.Item>
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
