import { expect, it } from 'vite-plus/test'
import { buildFileTree, fileIconKind } from './file-tree'

it('builds nested, folder-first trees with compressed directory chains and natural file ordering', () => {
  const files = [
    { path: 'README.md' },
    { path: 'src/ui/components/view10.tsx', viewed: false, additions: 4, deletions: 2 },
    { path: 'src/ui/components/view2.tsx', viewed: true, additions: 1, deletions: 0 },
    { path: 'src/main.ts', viewed: true, additions: 3, deletions: 1 },
    { path: 'src/main.ts', additions: 100 },
    { path: '.gitattributes' },
  ]
  const original = structuredClone(files)
  const nodes = buildFileTree(files)
  expect(nodes.map((node) => node.name)).toEqual(['src', '.gitattributes', 'README.md'])
  expect(nodes[0]).toMatchObject({
    kind: 'directory',
    path: 'src',
    count: 3,
    viewed: 2,
    additions: 8,
    deletions: 3,
    hasStats: true,
    children: [
      {
        kind: 'directory',
        path: 'src/ui/components',
        name: 'ui/components',
        count: 2,
        viewed: 1,
        additions: 5,
        deletions: 2,
        children: [
          { kind: 'file', name: 'view2.tsx', path: 'src/ui/components/view2.tsx' },
          { kind: 'file', name: 'view10.tsx', path: 'src/ui/components/view10.tsx' },
        ],
      },
      { kind: 'file', path: 'src/main.ts', viewed: true },
    ],
  })
  expect(files).toEqual(original)
})

it('keeps similarly named directories distinct and handles empty lists and unusual filenames', () => {
  expect(buildFileTree([])).toEqual([])
  expect(
    buildFileTree([{ path: 'src/file name.ts' }, { path: 'src2/line\nname.txt' }]),
  ).toMatchObject([
    { path: 'src', count: 1, hasStats: false, children: [{ path: 'src/file name.ts' }] },
    { path: 'src2', count: 1, hasStats: false, children: [{ path: 'src2/line\nname.txt' }] },
  ])
})

it('classifies filenames consistently across desktop and native file trees', () => {
  expect(
    [
      'src/view.tsx',
      'image.avif',
      'package.json',
      'pnpm-lock.yaml',
      '.env.local',
      'Dockerfile',
      'run.ps1',
      'README.md',
      'archive.zip',
    ].map(fileIconKind),
  ).toEqual(['code', 'image', 'data', 'config', 'config', 'config', 'terminal', 'text', 'file'])
})
