import { Check, ChevronDown, FileCode, Folder } from 'lucide-react'
import type { ChangedFile } from '@dovo/studio-core'
import { Button, cn } from '@dovo/studio-ui'
export function FileTree({
  files,
  selected,
  onSelect,
}: {
  files: ChangedFile[]
  selected: string
  onSelect: (path: string) => void
}) {
  const folders = [
    ...new Set(
      files.map((file) =>
        file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '',
      ),
    ),
  ]
  return (
    <div
      className="max-h-44 shrink-0 overflow-auto border-b bg-sidebar px-2 py-2"
      aria-label="Changed files"
    >
      {folders.map((folder) => (
        <details key={folder} open>
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1 text-[0.6875rem] text-muted-foreground">
            <ChevronDown size={12} />
            <Folder size={12} />
            {folder || 'Repository'}
          </summary>
          {files
            .filter(
              (f) =>
                (f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '') === folder,
            )
            .map((file) => (
              <Button
                key={file.path}
                variant="ghost"
                className={cn(
                  'h-7 w-full justify-start gap-2 rounded px-6 text-[0.6875rem] font-normal',
                  selected === file.path && 'bg-accent',
                )}
                onClick={() => onSelect(file.path)}
              >
                {file.viewed ? (
                  <Check className="size-3 text-emerald-400" />
                ) : (
                  <FileCode className="size-3 text-muted-foreground" />
                )}
                <span className="truncate">{file.path.split('/').pop()}</span>
                <span className="ml-auto text-[0.625rem] text-muted-foreground">
                  {file.before ? 'M' : 'A'}
                </span>
              </Button>
            ))}
        </details>
      ))}
    </div>
  )
}
