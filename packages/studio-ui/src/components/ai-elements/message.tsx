// Adapted from Vercel AI Elements (MIT), packages/elements/src/message.tsx.
import {
  memo,
  lazy,
  Suspense,
  useCallback,
  useMemo,
  type ReactNode,
  type ComponentProps,
  type HTMLAttributes,
} from 'react'
import { resolveMarkdownLink, localMarkdownURL, markdownURLLocalPath } from '@dovo/protocol'
import { Streamdown, defaultComponents } from 'streamdown'
import { createPierreCodePlugin } from '../../pierre-code-plugin'
import { resolveCodeTheme } from '@dovo/studio-core/code-themes'
import { useAppPreferences } from '@dovo/studio-core'
import { cn } from '../../lib/utils'
import { IconButton } from '../icon-button'
import { FileTypeIcon } from '../../file-tree'
import { markdownPluginsForLinks } from './markdown-plugins'
const MermaidResponse = lazy(() => import('./mermaid-response'))
const markdownControls = {
  code: { copy: true, download: false },
  table: false,
  mermaid: { copy: true, download: true, fullscreen: true, panZoom: true },
}
// The workbench owns link destinations and confirmation; keep real anchors so
// its thread and application click handlers can present the single chooser.
const markdownLinkSafety = { enabled: false }
export { Message, MessageContent } from '@dovo/web-ui/message'

export const MessageResponse = memo(function MessageResponse({
  children,
  isStreaming = false,
  preserveLineBreaks = false,
  baseURL,
  fileBaseURL,
  localFiles,
}: {
  children: string
  isStreaming?: boolean
  preserveLineBreaks?: boolean
  baseURL?: string
  fileBaseURL?: string
  localFiles?: {
    open: (path: string) => void
    image: (path: string, alt: string) => ReactNode
    remoteImage?: (uri: string, alt: string) => ReactNode
  }
}) {
  const { themePalette, codeTheme, importedCodeThemes } = useAppPreferences()
  const markdownPlugins = useMemo(
    () => ({
      code: createPierreCodePlugin([
        resolveCodeTheme(codeTheme, importedCodeThemes, themePalette, 'light'),
        resolveCodeTheme(codeTheme, importedCodeThemes, themePalette, 'dark'),
      ]),
    }),
    [themePalette, codeTheme, importedCodeThemes],
  )
  const urlTransform = useCallback(
    (url: string) => {
      if (localFiles && !baseURL && !fileBaseURL) {
        if (markdownURLLocalPath(url) !== undefined) return url
        const local = localMarkdownURL(url)
        if (local) return local
      }
      return resolveMarkdownLink(url, baseURL, fileBaseURL) ?? ''
    },
    [baseURL, fileBaseURL, localFiles],
  )
  const rehypePlugins = useMemo(
    () => markdownPluginsForLinks(baseURL, fileBaseURL, !!localFiles),
    [baseURL, fileBaseURL, localFiles],
  )
  const components = useMemo(
    () =>
      localFiles
        ? {
            a: (props: ComponentProps<'a'>) => {
              const path = props.href ? markdownURLLocalPath(props.href) : undefined
              return path !== undefined ? (
                <button
                  type="button"
                  title={path}
                  className="inline-flex max-w-full items-baseline gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 align-baseline text-left text-xs font-medium text-primary hover:bg-muted"
                  onClick={() => localFiles.open(path)}
                >
                  <FileTypeIcon path={path} />
                  <span className="wrap-anywhere">{props.children}</span>
                </button>
              ) : (
                <defaultComponents.a {...props} />
              )
            },
            img: ({ src, alt }: ComponentProps<'img'>) => {
              const path = typeof src === 'string' ? markdownURLLocalPath(src) : undefined
              return path !== undefined ? (
                localFiles.image(path, alt ?? 'Image')
              ) : typeof src === 'string' && localFiles.remoteImage ? (
                localFiles.remoteImage(src, alt ?? 'Image')
              ) : (
                <defaultComponents.img src={src} alt={alt} />
              )
            },
          }
        : undefined,
    [localFiles],
  )
  const props = {
    className: cn(
      'studio-markdown min-w-0 max-w-full',
      preserveLineBreaks && '[&_p]:whitespace-pre-wrap',
    ),
    plugins: markdownPlugins,
    controls: markdownControls,
    linkSafety: markdownLinkSafety,
    codeBlockMaxHeight: 400,
    tableMaxHeight: 400,
    lineNumbers: false,
    urlTransform,
    rehypePlugins,
    mode: isStreaming ? ('streaming' as const) : ('static' as const),
    isAnimating: isStreaming,
    children,
    components,
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
