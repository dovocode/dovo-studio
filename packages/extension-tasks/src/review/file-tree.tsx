import { FileIcon, DiffAmounts } from '../files/presentation'
import { Check, ChevronDown } from 'lucide-react'
import type { ChangedFile } from '@dovo/studio-core'
import { Button, cn } from '@dovo/studio-ui'

type Folder = { name: string; folders: Map<string, Folder>; files: ChangedFile[] }
type DiffStat = { path: string; additions: number; deletions: number }

function fileTree(files: ChangedFile[]): Folder {
  const root: Folder = { name: '', folders: new Map(), files: [] }
  for (const file of files) {
    const parts = file.path.split('/')
    let folder = root
    for (const name of parts.slice(0, -1)) {
      let child = folder.folders.get(name)
      if (!child) {
        child = { name, folders: new Map(), files: [] }
        folder.folders.set(name, child)
      }
      folder = child
    }
    folder.files.push(file)
  }
  return root
}

function FolderRows({
  folder,
  stats,
  prefix = '',
  selected,
  onSelect,
}: {
  folder: Folder
  prefix?: string
  stats: Map<string, DiffStat>
  selected: string
  onSelect: (path: string) => void
}) {
  return (
    <>
      {[...folder.folders.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((child) => (
          <details key={child.name} open className="group/folder">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-2 py-1 text-[0.6875rem] text-muted-foreground hover:bg-accent/50">
              <ChevronDown className="size-3 shrink-0 -rotate-90 transition-transform group-open/folder:rotate-0" />
              <span className="min-w-0 flex-1 truncate">{child.name}</span>
              <DiffAmounts
                stats={[...stats.values()]
                  .filter((stat) => stat.path.startsWith(`${prefix}${child.name}/`))
                  .reduce(
                    (total, stat) => ({
                      additions: total.additions + stat.additions,
                      deletions: total.deletions + stat.deletions,
                    }),
                    { additions: 0, deletions: 0 },
                  )}
              />
            </summary>
            <div className="ml-3 border-l border-border/60 pl-1">
              <FolderRows
                folder={child}
                stats={stats}
                selected={selected}
                onSelect={onSelect}
                prefix={`${prefix}${child.name}/`}
              />
            </div>
          </details>
        ))}
      {[...folder.files]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((file) => (
          <Button
            key={file.path}
            variant="ghost"
            className={cn(
              'h-7 w-full justify-start gap-2 rounded px-2 text-[0.6875rem] font-normal',
              selected === file.path && 'bg-accent text-foreground',
            )}
            title={file.path}
            onClick={() => onSelect(file.path)}
          >
            <FileIcon path={file.path} />
            {file.viewed && <Check className="size-3 shrink-0 text-emerald-400" />}
            <span className="min-w-0 flex-1 truncate text-left">{file.path.split('/').at(-1)}</span>
            <DiffAmounts stats={stats.get(file.path)} />
            <span className="text-[0.625rem] text-muted-foreground">{file.before ? 'M' : 'A'}</span>
          </Button>
        ))}
    </>
  )
}

export function FileTree({
  files,
  stats,
  selected,
  onSelect,
}: {
  files: ChangedFile[]
  stats: DiffStat[]
  selected: string
  onSelect: (path: string) => void
}) {
  return (
    <aside
      className="flex w-64 max-w-[40%] shrink-0 flex-col border-l bg-sidebar"
      aria-label="Changed files"
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3 text-xs font-medium">
        <span>Files</span>
        <span className="tabular-nums text-muted-foreground">{files.length}</span>
      </div>
      <div className="min-h-0 overflow-auto p-2">
        <FolderRows
          folder={fileTree(files)}
          stats={new Map(stats.map((stat) => [stat.path, stat]))}
          selected={selected}
          onSelect={onSelect}
        />
      </div>
    </aside>
  )
}
