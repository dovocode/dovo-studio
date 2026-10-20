import { expect, it } from 'vite-plus/test'
import { decode, artifactCreateSchema } from '@dovo/protocol'
import { compileArtifactBundle } from './artifact-bundle.js'

const bundleFiles = [
  {
    path: 'pages/index.html',
    content:
      '<!doctype html><html><head><link rel="stylesheet" href="../styles/main.css"></head><body><button id="count">0</button><img id="logo" src="../assets/logo.svg"><script type="module" src="../scripts/main.js"></script></body></html>',
  },
  {
    path: 'styles/main.css',
    content:
      '@import "./colors.css"; #count { color: rgb(10, 20, 30); background-image: url(../assets/logo.svg) }',
  },
  { path: 'styles/colors.css', content: 'body { --bundle-color: blue }' },
  {
    path: 'scripts/main.js',
    content:
      'import { step } from "./step.js"; document.querySelector("#count").onclick = event => event.target.textContent = step(Number(event.target.textContent));',
  },
  { path: 'scripts/step.js', content: 'export const step = value => value + 2;' },
  {
    path: 'assets/logo.svg',
    content:
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="blue"/></svg>',
  },
]
it('bundles nested HTML, CSS imports, module imports and assets without using the host filesystem', async () => {
  const content = await compileArtifactBundle(bundleFiles, 'pages/index.html')
  expect(content).toContain('value + 2')
  expect(content).toContain('data:image/svg+xml')
  expect(content).toContain('--bundle-color')
  expect(content).not.toContain('src="../')
  expect(content).not.toContain('href="../')
})
it.each(['../outside.html', '/absolute.html', 'C:/secret', 'a/../b', 'a\\b', 'a%2fb', 'a//b'])(
  'rejects non-portable artifact paths: %s',
  (path) => {
    expect(() =>
      decode(artifactCreateSchema, {
        taskId: 'thread',
        title: 'Folder',
        format: 'html',
        files: [{ path, content: '' }],
      }),
    ).toThrow(/relative file path/)
  },
)
it.each([
  ['index.html', 'INDEX.html'],
  ['images', 'images/logo.svg'],
])('rejects duplicate and file/folder collisions: %s, %s', (first, second) => {
  expect(() =>
    decode(artifactCreateSchema, {
      taskId: 'thread',
      title: 'Folder',
      format: 'html',
      files: [
        { path: first, content: '' },
        { path: second, content: '' },
      ],
    }),
  ).toThrow(/distinct file paths/)
})
it('reports missing files, external dependencies, invalid assets and invalid entrypoints', async () => {
  for (const content of [
    '<script src="missing.js"></script>',
    '<script src="https://example.com/main.js"></script>',
    '<script type="module">import "node:fs";</script>',
    '<script type="module">import "react";</script>',
    '<link rel="stylesheet" href="/etc/passwd">',
  ])
    await expect(
      compileArtifactBundle([{ path: 'index.html', content }], 'index.html'),
    ).rejects.toThrow(/artifact|bundled/i)
  await expect(
    compileArtifactBundle([{ path: 'index.html', content: '' }], 'missing.html'),
  ).rejects.toThrow('entry file')
  await expect(
    compileArtifactBundle(
      [
        { path: 'index.html', content: '' },
        { path: 'asset.png', content: 'not-base64!', encoding: 'base64' },
      ],
      'index.html',
    ),
  ).rejects.toThrow('base64')
})

it('preserves classic script globals used by HTML event handlers', async () => {
  const content = await compileArtifactBundle(
    [
      {
        path: 'index.html',
        content: '<button onclick="increment()">Go</button><script src="main.js"></script>',
      },
      { path: 'main.js', content: 'function increment(){document.body.dataset.clicked="yes"}' },
    ],
    'index.html',
  )
  expect(content).toContain('function increment()')
})
