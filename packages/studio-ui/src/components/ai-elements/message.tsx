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
import {
  resolveMarkdownLink,
  localMarkdownURL,
  markdownURLLocalPath,
  messageReferences,
  composerReferenceIcon,
  composerIconMasks,
  harnessIconData,
  type ComposerReference,
  type ComposerReferenceResources,
} from '@dovo/protocol'
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
const noReferenceChips: ReadonlyMap<string, ComposerReference & { source: string }> = new Map()

export const MessageResponse = memo(function MessageResponse({
  children,
  isStreaming = false,
  preserveLineBreaks = false,
  baseURL,
  fileBaseURL,
  localFiles,
  referenceResources,
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
  referenceResources?: ComposerReferenceResources
}) {
  const { themePalette, codeTheme, importedCodeThemes } = useAppPreferences()
  const referenced = useMemo(() => {
    if (!referenceResources) return { text: children, chips: noReferenceChips }
    const chips = new Map<string, ComposerReference & { source: string }>()
    // Keep authored links separate from the links used only by this render.
    let prefix = 'https://dovo-reference.invalid/'
    while (children.includes(prefix)) prefix += '_/'
    let text = ''
    let offset = 0
    for (const reference of messageReferences(children, referenceResources)) {
      const href = `${prefix}${chips.size}`
      chips.set(href, { ...reference, source: children.slice(reference.start, reference.end) })
      const label = reference.label.replace(/[\\[\]]/g, '\\$&')
      text += `${children.slice(offset, reference.start)}[${label}](${href})`
      offset = reference.end
    }
    return { text: text + children.slice(offset), chips: chips.size ? chips : noReferenceChips }
  }, [children, referenceResources])
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
      if (referenced.chips.has(url)) return url
      if (localFiles && !baseURL && !fileBaseURL) {
        if (markdownURLLocalPath(url) !== undefined) return url
        const local = localMarkdownURL(url)
        if (local) return local
      }
      return resolveMarkdownLink(url, baseURL, fileBaseURL) ?? ''
    },
    [baseURL, fileBaseURL, localFiles, referenced.chips],
  )
  const rehypePlugins = useMemo(
    () => markdownPluginsForLinks(baseURL, fileBaseURL, !!localFiles),
    [baseURL, fileBaseURL, localFiles],
  )
  const components = useMemo(
    () =>
      localFiles || referenced.chips.size
        ? {
            a: (props: ComponentProps<'a'>) => {
              const reference = props.href && referenced.chips.get(props.href)
              if (reference) return <MessageReference reference={reference} />
              const path = props.href ? markdownURLLocalPath(props.href) : undefined
              return path !== undefined && localFiles ? (
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
              return path !== undefined && localFiles ? (
                localFiles.image(path, alt ?? 'Image')
              ) : typeof src === 'string' && localFiles?.remoteImage ? (
                localFiles.remoteImage(src, alt ?? 'Image')
              ) : (
                <defaultComponents.img src={src} alt={alt} />
              )
            },
          }
        : undefined,
    [localFiles, referenced.chips],
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
    children: referenced.text,
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
function MessageReference({ reference }: { reference: ComposerReference & { source: string } }) {
  const icon = reference.provider && harnessIconData[reference.provider]
  return (
    <span
      className="dovo-composer-reference"
      data-reference-kind={reference.kind}
      title={reference.source}
      aria-label={`${reference.kind}: ${reference.source}`}
    >
      {icon ? (
        <svg
          className="dovo-composer-reference-icon"
          data-harness={reference.provider}
          viewBox={icon.viewBox}
          fill={icon.fill ?? 'currentColor'}
          aria-hidden="true"
        >
          {icon.paths.map((path, index) => (
            <path key={index} d={path.d} opacity={path.opacity} />
          ))}
        </svg>
      ) : (
        <span
          className="dovo-composer-reference-icon"
          data-reference-icon={composerReferenceIcon(reference)}
          aria-hidden="true"
          style={{
            maskImage: `url("${composerIconMasks[composerReferenceIcon(reference)]}")`,
            maskSize: 'contain',
            maskRepeat: 'no-repeat',
            backgroundColor: 'currentColor',
          }}
        />
      )}
      <span className="dovo-composer-reference-label">{reference.label}</span>
    </span>
  )
}
export function MessageActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center gap-1 group-[.is-user]:ml-auto', className)} {...props} />
  )
}
export const MessageAction = IconButton
