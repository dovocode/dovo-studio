import type { PullDetail } from '@dovo/studio-core'
type Node = { directories: Map<string, Node>; files: PullDetail['files'] }
function tree(files: PullDetail['files']) {
  const root: Node = { directories: new Map(), files: [] }
  for (const file of files) {
    let node = root
    for (const part of file.path.split('/').slice(0, -1)) {
      let child = node.directories.get(part)
      if (!child) {
        child = { directories: new Map(), files: [] }
        node.directories.set(part, child)
      }
      node = child
    }
    node.files.push(file)
  }
  return root
}
export function PullFileTree({
  files,
  selected,
  viewed,
  onSelect,
}: {
  files: PullDetail['files']
  selected: string
  viewed: Set<string>
  onSelect: (path: string) => void
}) {
  const render = (node: Node) => (
    <>
      {[...node.directories]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, child]) => (
          <details key={name} open className="pl-2">
            <summary className="cursor-pointer py-1 text-[0.6875rem] text-muted-foreground">
              {name}/
            </summary>
            {render(child)}
          </details>
        ))}
      {node.files.map((file) => (
        <button
          key={file.path}
          title={file.path}
          aria-current={selected === file.path ? 'true' : undefined}
          onClick={() => onSelect(file.path)}
          className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-[0.6875rem] ${selected === file.path ? 'bg-accent' : 'hover:bg-accent/50'}`}
        >
          <span className="min-w-0 flex-1 truncate">{file.path.split('/').at(-1)}</span>
          <span className="text-muted-foreground">
            {viewed.has(file.path)
              ? '✓'
              : file.status === 'added'
                ? 'A'
                : file.status === 'removed'
                  ? 'D'
                  : 'M'}
          </span>
        </button>
      ))}
    </>
  )
  return <nav aria-label="Changed files">{render(tree(files))}</nav>
}
