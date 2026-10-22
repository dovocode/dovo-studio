import type { PullDetail } from './pulls.js'

type File = Pick<PullDetail['files'][number], 'path' | 'attributes'>
type FileKind = 'normal' | 'mocks' | 'tests' | 'docs' | 'generated'
const lockfiles = new Set([
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'composer.lock',
  'deno.lock',
  'flake.lock',
  'gemfile.lock',
  'go.sum',
  'gradle.lockfile',
  'mix.lock',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'packages.lock.json',
  'pipfile.lock',
  'pnpm-lock.yaml',
  'podfile.lock',
  'poetry.lock',
  'pubspec.lock',
  'uv.lock',
  'yarn.lock',
])

/** Path conventions, as used by T3 Code: test support is separate from executable tests.
 * This is a review aid, not source analysis; explicit generated attributes take precedence. */
export function pullFileKind(file: File): FileKind {
  const parts = file.path.replaceAll('\\', '/').split('/')
  const name = parts.pop() ?? ''
  const directories = new Set(parts.map((part) => part.toLowerCase()))
  const inside = (...names: string[]) => names.some((name) => directories.has(name))
  if (
    file.attributes?.generated ||
    lockfiles.has(name.toLowerCase()) ||
    /\.(?:generated|gen)\.|\.g\.dart$|\.pb\.(?:go|cc|h)$|_pb2(?:_grpc)?\.py$|\.min\.(?:js|css)$|\.(?:js|css)\.map$/.test(
      name,
    ) ||
    inside('generated', '__generated__')
  )
    return 'generated'
  if (
    /\.snap$|\.(?:mocks?|fixtures?|stubs?|fakes?)\.[^.]+$|^(?:mocks?|fixtures?|stubs?|fakes?)(?:[-_.A-Z]|$)/.test(
      name,
    ) ||
    inside(
      '__mocks__',
      '__fixtures__',
      '__snapshots__',
      'mock',
      'mocks',
      'fixture',
      'fixtures',
      'stubs',
      'fakes',
      'testdata',
    )
  )
    return 'mocks'
  if (
    /[._](?:test|spec|e2e|cy)\.[^.]+$|^test_.+\.py$|^conftest\.py$|^(?:vitest|jest)\.setup\.[^.]+$/i.test(
      name,
    ) ||
    /(?:Tests?|Spec)\.(?:java|kt|kts|scala|groovy|cs|php|swift|m)$/.test(name) ||
    inside('__tests__', '__test__', 'test', 'tests', 'spec', 'specs', 'e2e', 'cypress')
  )
    return 'tests'
  if (
    /\.(?:md|mdx|markdown|rst|adoc|txt)$/i.test(name) &&
    !/^(?:requirements.*|constraints.*|CMakeLists|robots|llms)\.txt$/i.test(name)
  )
    return 'docs'
  return 'normal'
}

/** Count the complete PR file list, independently of diff display filters or review ordering. */
export function pullFileBreakdown(files: readonly File[], total?: number | null) {
  const counts: Record<FileKind, number> = { normal: 0, mocks: 0, tests: 0, docs: 0, generated: 0 }
  const paths = new Set<string>()
  for (const file of files) {
    if (paths.has(file.path)) continue
    paths.add(file.path)
    counts[pullFileKind(file)]++
  }
  return (
    `${counts.normal} normal file${counts.normal === 1 ? '' : 's'} · ${counts.mocks} mock${counts.mocks === 1 ? '' : 's'} · ${counts.tests} test${counts.tests === 1 ? '' : 's'}` +
    (counts.docs ? ` · ${counts.docs} docs` : '') +
    (counts.generated ? ` · ${counts.generated} generated` : '') +
    (total != null && total > paths.size ? ` (${paths.size} of ${total} files loaded)` : '')
  )
}
