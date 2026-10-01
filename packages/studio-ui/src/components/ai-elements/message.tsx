// Adapted from Vercel AI Elements (MIT), packages/elements/src/message.tsx.
import { memo, lazy, Suspense, useCallback, useMemo, type HTMLAttributes } from 'react'
import { resolveMarkdownLink } from '@dovo/protocol'
import { Streamdown } from 'streamdown'
import { code } from '@streamdown/code'
import { cn } from '../../lib/utils'
import { IconButton } from '../icon-button'
import { markdownPluginsForLinks } from './markdown-plugins'
const MermaidResponse = lazy(() => import('./mermaid-response'))
const markdownPlugins = { code }
const markdownControls = {
  code: { copy: true, download: false },
  table: false,
  mermaid: { copy: true, download: true, fullscreen: true, panZoom: true },
}
export function Message({
  from,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { from: 'user' | 'assistant' }) {
  return (
    <div
      className={cn(
        'group flex w-full flex-col gap-2',
        from === 'user' ? 'is-user ml-auto max-w-[90%]' : 'is-assistant',
        className,
      )}
      {...props}
    />
  )
}
export function MessageContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm group-[.is-user]:ml-auto group-[.is-user]:rounded-2xl group-[.is-user]:bg-[#151515] group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-white',
        className,
      )}
      {...props}
    />
  )
}
export const MessageResponse = memo(function MessageResponse({
  children,
  isStreaming = false,
  baseURL,
  fileBaseURL,
}: {
  children: string
  isStreaming?: boolean
  baseURL?: string
  fileBaseURL?: string
}) {
  const urlTransform = useCallback(
    (url: string) => resolveMarkdownLink(url, baseURL, fileBaseURL) ?? '',
    [baseURL, fileBaseURL],
  )
  const rehypePlugins = useMemo(
    () => markdownPluginsForLinks(baseURL, fileBaseURL),
    [baseURL, fileBaseURL],
  )
  const props = {
    className: 'studio-markdown min-w-0 max-w-full',
    plugins: markdownPlugins,
    controls: markdownControls,
    codeBlockMaxHeight: 400,
    tableMaxHeight: 400,
    lineNumbers: false,
    urlTransform,
    rehypePlugins,
    mode: isStreaming ? ('streaming' as const) : ('static' as const),
    isAnimating: isStreaming,
    children,
  }
  const markdown = <Streamdown {...props} />
  return /(?:^|\n) {0,3}(?:`{3,}|~{3,})mermaid(?:\s|$)/i.test(children) ? (
    <Suspense fallback={markdown}>
      <MermaidResponse {...props} />
    </Suspense>
  ) : (
    markdown
  )
})
export function MessageActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center gap-1 group-[.is-user]:ml-auto', className)} {...props} />
  )
}
export const MessageAction = IconButton
