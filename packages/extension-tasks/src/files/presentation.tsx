import { parseDiffFromFile } from '@pierre/diffs'
import {
  File,
  FileCode2,
  FileImage,
  FileJson,
  FileText,
  FileTerminal,
  Settings2,
} from 'lucide-react'
import type { ChangedFile } from '@dovo/studio-core'
export function fileStats(file: ChangedFile) {
  if (file.preview) return { path: file.path, additions: 0, deletions: 0 }
  const diff = parseDiffFromFile(
    { name: file.path, contents: file.before },
    { name: file.path, contents: file.after },
  )
  return {
    path: file.path,
    additions: diff.hunks.reduce((n, h) => n + h.additionLines, 0),
    deletions: diff.hunks.reduce((n, h) => n + h.deletionLines, 0),
  }
}
export function FileIcon({ path }: { path: string }) {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  const Icon = /^(tsx?|jsx?|py|rb|go|rs|java|css|scss|html|vue|svelte)$/.test(extension)
    ? FileCode2
    : /^(png|jpe?g|gif|svg|webp|heic|ico)$/.test(extension)
      ? FileImage
      : /^(json|jsonc)$/.test(extension)
        ? FileJson
        : /^(ya?ml|toml|ini|env)$/.test(extension)
          ? Settings2
          : /^(sh|bash|zsh)$/.test(extension)
            ? FileTerminal
            : /^(md|txt|log)$/.test(extension)
              ? FileText
              : File
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
}
export function DiffAmounts({
  stats,
}: {
  stats: { additions: number; deletions: number } | undefined
}) {
  if (!stats) return null
  return (
    <span className="flex shrink-0 gap-1.5 text-[0.625rem] tabular-nums">
      <span className="text-emerald-500">+{stats.additions}</span>
      <span className="text-rose-500">-{stats.deletions}</span>
    </span>
  )
}
