import type { FileKind } from '../pulls/file-breakdown.js'
export type FileTreeEntry = {
  path: string
  changeKind?: FileKind
  viewed?: boolean
  label?: string
  additions?: number
  deletions?: number
}
export type FileTreeFile = FileTreeEntry & { kind: 'file'; name: string }
export type FileTreeDirectory = {
  kind: 'directory'
  path: string
  name: string
  children: FileTreeNode[]
  count: number
  viewed: number
  additions: number
  deletions: number
  hasStats: boolean
}
export type FileTreeNode = FileTreeFile | FileTreeDirectory

/** Folder-first hierarchy; single-directory chains collapse into one readable path. */
export function buildFileTree(files: readonly FileTreeEntry[]): FileTreeNode[] {
  type Branch = { path: string; name: string; folders: Map<string, Branch>; files: FileTreeFile[] }
  const root: Branch = { path: '', name: '', folders: new Map(), files: [] }
  const seen = new Set<string>()
  for (const file of files) {
    if (!file.path || seen.has(file.path)) continue
    seen.add(file.path)
    const parts = file.path.split('/')
    let branch = root
    for (const name of parts.slice(0, -1)) {
      let child = branch.folders.get(name)
      if (!child) {
        child = {
          path: branch.path ? `${branch.path}/${name}` : name,
          name,
          folders: new Map(),
          files: [],
        }
        branch.folders.set(name, child)
      }
      branch = child
    }
    branch.files.push({ ...file, kind: 'file', name: parts.at(-1) ?? file.path })
  }
  const compare = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  const nodes = (branch: Branch): FileTreeNode[] => [
    ...[...branch.folders.values()].sort(compare).map((folder): FileTreeDirectory => {
      let name = folder.name
      while (!folder.files.length && folder.folders.size === 1) {
        const child = folder.folders.values().next().value
        if (!child) break
        name += `/${child.name}`
        folder = child
      }
      const children = nodes(folder)
      return {
        kind: 'directory',
        path: folder.path,
        name,
        children,
        count: children.reduce(
          (total, node) => total + (node.kind === 'directory' ? node.count : 1),
          0,
        ),
        viewed: children.reduce(
          (total, node) =>
            total + (node.kind === 'directory' ? node.viewed : Number(!!node.viewed)),
          0,
        ),
        additions: children.reduce((total, node) => total + (node.additions ?? 0), 0),
        deletions: children.reduce((total, node) => total + (node.deletions ?? 0), 0),
        hasStats: children.some((node) =>
          node.kind === 'directory'
            ? node.hasStats
            : node.additions !== undefined || node.deletions !== undefined,
        ),
      }
    }),
    ...branch.files.sort(compare),
  ]
  return nodes(root)
}

export function fileIconKind(path: string) {
  const name = path.split('/').at(-1)?.toLowerCase() ?? ''
  const extension = name.split('.').at(-1) ?? ''
  if (
    /^(tsx?|jsx?|py|rb|go|rs|java|kt|swift|cs|php|css|scss|html|vue|svelte|sql|c|cpp|h)$/.test(
      extension,
    )
  )
    return 'code'
  if (/^(png|jpe?g|gif|svg|webp|heic|ico|avif)$/.test(extension)) return 'image'
  if (/^(json|jsonc|lock)$/.test(extension)) return 'data'
  if (
    /^(ya?ml|toml|ini|env)$/.test(extension) ||
    name.startsWith('.env') ||
    /^(dockerfile|\.gitignore|\.gitattributes|\.npmrc)$/.test(name)
  )
    return 'config'
  if (/^(sh|bash|zsh|ps1|bat|cmd)$/.test(extension)) return 'terminal'
  if (/^(md|mdx|txt|log|csv)$/.test(extension) || /^(readme|license)(\.|$)/.test(name))
    return 'text'
  return 'file'
}
