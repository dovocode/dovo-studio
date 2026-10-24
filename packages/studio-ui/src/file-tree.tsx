import { useEffect, useMemo, useRef, useState } from 'react'
import { buildFileTree, fileIconKind, type FileTreeEntry, type FileTreeNode } from '@dovo/protocol'
import {
  Check,
  ChevronRight,
  File,
  FileCode2,
  FileImage,
  FileJson,
  FileTerminal,
  FileText,
  Folder,
  FolderOpen,
  Settings2,
} from 'lucide-react'
import { ChangeTypeIndicator } from './review/change-types'
import { cn } from './lib/utils'

const icons = {
  code: { icon: FileCode2, color: 'text-sky-500 dark:text-sky-400' },
  image: { icon: FileImage, color: 'text-violet-500 dark:text-violet-400' },
  data: { icon: FileJson, color: 'text-amber-600 dark:text-amber-400' },
  config: { icon: Settings2, color: 'text-muted-foreground' },
  terminal: { icon: FileTerminal, color: 'text-emerald-600 dark:text-emerald-400' },
  text: { icon: FileText, color: 'text-muted-foreground' },
  file: { icon: File, color: 'text-muted-foreground' },
}
export function FileTypeIcon({ path }: { path: string }) {
  const { icon: Icon, color } = icons[fileIconKind(path)]
  return <Icon aria-hidden className={cn('size-3.5 shrink-0', color)} />
}
export function FileChangeCounts({
  additions,
  deletions,
}: {
  additions?: number
  deletions?: number
}) {
  if (additions === undefined && deletions === undefined) return null
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-[0.625rem] font-mono tabular-nums"
      aria-label={`${additions ?? 0} additions, ${deletions ?? 0} deletions`}
    >
      {!!additions && <span className="text-status-success">+{additions.toLocaleString()}</span>}
      {!!deletions && <span className="text-status-error">−{deletions.toLocaleString()}</span>}
    </span>
  )
}
function ancestors(path: string) {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}
export function FileBrowserTree({
  files,
  selected = '',
  onSelect,
  disabled = false,
  search = '',
  flat = false,
  defaultExpandedDepth = 1,
}: {
  files: readonly FileTreeEntry[]
  selected?: string
  onSelect: (path: string) => void
  disabled?: boolean
  search?: string
  flat?: boolean
  defaultExpandedDepth?: number
}) {
  const container = useRef<HTMLDivElement>(null)
  const lastFocused = useRef<HTMLButtonElement | null>(null)
  const [focused, setFocused] = useState(selected)
  const [expanded, setExpanded] = useState(
    () => new Map(ancestors(selected).map((path) => [path, true])),
  )
  const [searchClosed, setSearchClosed] = useState({ query: '', paths: new Set<string>() })
  const nodes = useMemo<FileTreeNode[]>(
    () =>
      flat
        ? files.map((file) => ({
            ...file,
            kind: 'file',
            name: file.path.split('/').at(-1) ?? file.path,
          }))
        : buildFileTree(files),
    [files, flat],
  )
  useEffect(() => {
    setExpanded((previous) => {
      const next = new Map(previous)
      for (const path of ancestors(selected)) next.set(path, true)
      return next
    })
  }, [selected])
  const isOpen = (node: FileTreeNode, depth: number) =>
    search
      ? searchClosed.query !== search || !searchClosed.paths.has(node.path)
      : (expanded.get(node.path) ??
        (depth < defaultExpandedDepth || selected.startsWith(`${node.path}/`)))
  const visible: string[] = []
  const collect = (items: FileTreeNode[], depth = 0) => {
    for (const node of items) {
      if (node.kind === 'directory' || !disabled) visible.push(node.path)
      if (node.kind === 'directory' && isOpen(node, depth)) collect(node.children, depth + 1)
    }
  }
  collect(nodes)
  const tabPath = [focused, ...ancestors(focused).reverse(), selected, visible[0]].find((path) =>
    visible.includes(path),
  )
  useEffect(() => {
    if (
      lastFocused.current &&
      !lastFocused.current.isConnected &&
      document.activeElement === document.body
    )
      container.current
        ?.querySelector<HTMLButtonElement>('[data-file-tree-row][tabindex="0"]')
        ?.focus()
  }, [tabPath, nodes])
  const render = (nodes: FileTreeNode[], depth = 0, parent = '') =>
    nodes.map((node) => {
      if (node.kind === 'directory') {
        const open = isOpen(node, depth)
        const FolderIcon = open ? FolderOpen : Folder
        return (
          <div key={node.path}>
            <button
              type="button"
              data-file-tree-row
              tabIndex={tabPath === node.path ? 0 : -1}
              data-path={node.path}
              data-parent={parent}
              aria-label={node.path}
              aria-expanded={open}
              title={node.path}
              onClick={() => {
                if (search)
                  setSearchClosed((previous) => {
                    const paths = new Set(previous.query === search ? previous.paths : [])
                    if (open) paths.add(node.path)
                    else paths.delete(node.path)
                    return { query: search, paths }
                  })
                else setExpanded((previous) => new Map(previous).set(node.path, !open))
              }}
              className="flex min-h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            >
              <ChevronRight
                aria-hidden
                className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
              />
              <FolderIcon
                aria-hidden
                className="size-3.5 shrink-0 text-amber-600/80 dark:text-amber-400/80"
              />
              <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
              {node.hasStats && (
                <FileChangeCounts additions={node.additions} deletions={node.deletions} />
              )}
            </button>
            {open && (
              <div className={cn(depth < 4 && 'ml-[13px] border-l border-border/50 pl-1')}>
                {render(node.children, depth + 1, node.path)}
              </div>
            )}
          </div>
        )
      }
      return (
        <button
          key={node.path}
          type="button"
          data-file-tree-row
          tabIndex={tabPath === node.path ? 0 : -1}
          data-path={node.path}
          data-parent={parent}
          aria-current={selected === node.path ? 'true' : undefined}
          aria-label={`${node.path}${node.viewed === undefined ? '' : node.viewed ? ', viewed' : ', unviewed'}`}
          title={node.path}
          disabled={disabled}
          onClick={() => onSelect(node.path)}
          className={cn(
            'relative flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50',
            selected === node.path &&
              'bg-accent text-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary',
            node.viewed && selected !== node.path && 'text-muted-foreground',
          )}
        >
          <span className="flex w-3 shrink-0 justify-center">
            {node.changeKind && <ChangeTypeIndicator kind={node.changeKind} />}
          </span>
          <FileTypeIcon path={node.path} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{node.name}</span>
            {flat && node.path.includes('/') && (
              <span className="block truncate text-[0.625rem] text-muted-foreground">
                {node.path.slice(0, node.path.lastIndexOf('/'))}
              </span>
            )}
          </span>
          <FileChangeCounts additions={node.additions} deletions={node.deletions} />
          {node.label && (
            <span
              className="max-w-20 truncate text-[0.625rem] text-muted-foreground"
              title={node.label}
            >
              {node.label}
            </span>
          )}
          {node.viewed && (
            <Check
              aria-label="Viewed"
              className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
          )}
        </button>
      )
    })
  return (
    <div
      ref={container}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLButtonElement && event.target.dataset.path) {
          lastFocused.current = event.target
          setFocused(event.target.dataset.path)
        }
      }}
      onBlurCapture={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !container.current?.contains(event.relatedTarget)
        )
          lastFocused.current = null
      }}
      className="min-w-0"
      onKeyDown={(event) => {
        if (
          !(event.target instanceof HTMLButtonElement) ||
          !event.target.hasAttribute('data-file-tree-row')
        )
          return
        const current = event.target
        const rows = [
          ...(container.current?.querySelectorAll<HTMLButtonElement>(
            '[data-file-tree-row]:not(:disabled)',
          ) ?? []),
        ]
        const index = rows.indexOf(event.target)
        let target: HTMLButtonElement | undefined
        if (event.key === 'ArrowDown') target = rows[index + 1]
        else if (event.key === 'ArrowUp') target = rows[index - 1]
        else if (event.key === 'Home') target = rows[0]
        else if (event.key === 'End') target = rows.at(-1)
        else if (
          event.key === 'ArrowRight' &&
          event.target.getAttribute('aria-expanded') === 'false'
        )
          event.target.click()
        else if (event.key === 'ArrowLeft') {
          if (event.target.getAttribute('aria-expanded') === 'true') event.target.click()
          else target = rows.find((row) => row.dataset.path === current.dataset.parent)
        } else return
        event.preventDefault()
        target?.focus()
      }}
    >
      {render(nodes)}
    </div>
  )
}
