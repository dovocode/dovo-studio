import { filePreviewLabel, type ReviewGroup } from '@dovo/protocol'
import type { ChangedFile } from '@dovo/studio-core'
import { ReviewFiles } from '@dovo/studio-ui'
import { ResizableSidebar } from '../detail/resizable-sidebar'
export function FileTree({
  files,
  stats,
  selected,
  onSelect,
  groups = [],
  related = false,
  onRelatedChange = () => {},
  disabled = false,
}: {
  files: ChangedFile[]
  stats: { path: string; additions: number; deletions: number }[]
  selected: string
  onSelect: (path: string) => void
  groups?: ReviewGroup[]
  related?: boolean
  onRelatedChange?: (value: boolean) => void
  disabled?: boolean
}) {
  const amounts = new Map(stats.map((stat) => [stat.path, stat]))
  return (
    <ResizableSidebar
      preference="diffFilesSidebarWidth"
      side="right"
      label="diff files pane"
      maxFraction={0.4}
      maxWidth={640}
      className="flex min-h-0 flex-col overflow-hidden border-l bg-sidebar"
      aria-label="Changed files"
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3 text-xs font-medium">
        <span>Files</span>
        <span className="tabular-nums text-muted-foreground">{files.length}</span>
      </div>
      <ReviewFiles
        files={files.map((file) => {
          const stats = amounts.get(file.path)
          return {
            path: file.path,
            viewed: file.viewed,
            label: file.preview ? filePreviewLabel(file) : undefined,
            additions: file.preview ? undefined : (stats?.additions ?? 0),
            deletions: file.preview ? undefined : (stats?.deletions ?? 0),
          }
        })}
        groups={groups}
        related={related}
        onRelatedChange={onRelatedChange}
        selected={selected}
        onSelect={onSelect}
        disabled={disabled}
      />
    </ResizableSidebar>
  )
}
