import { posix } from 'node:path'
import type { SourceAnalysis } from './languages.js'
export type AnalyzedSource = { path: string; analysis: SourceAnalysis | null }
const jsExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']
function javascript(path: string, specifier: string, files: Map<string, AnalyzedSource>) {
  if (!specifier.startsWith('.')) return []
  const base = posix.normalize(posix.join(posix.dirname(path), specifier))
  const ext = posix.extname(base)
  const replacements =
    ext === '.mjs'
      ? ['.mts', '.mjs']
      : ext === '.cjs'
        ? ['.cts', '.cjs']
        : ext === '.js'
          ? ['.ts', '.tsx', '.js', '.jsx']
          : ext === '.jsx'
            ? ['.tsx', '.jsx']
            : []
  const candidates = replacements.length
    ? replacements.map((suffix) => base.slice(0, -ext.length) + suffix)
    : ext
      ? [base]
      : [
          base,
          ...jsExtensions.map((suffix) => base + suffix),
          ...jsExtensions.map((suffix) => posix.join(base, 'index' + suffix)),
        ]
  const target = candidates.map((candidate) => files.get(candidate)?.path).find(Boolean)
  return target ? [target] : []
}
function unique(candidates: string[]) {
  const paths = [...new Set(candidates)]
  return paths.length === 1 ? paths : []
}
function python(path: string, specifier: string, files: Map<string, AnalyzedSource>) {
  const dots = specifier.match(/^\.+/)?.[0].length ?? 0
  const module = specifier.slice(dots).replaceAll('.', '/')
  const base = dots
    ? posix.normalize(
        posix.join(posix.dirname(path), ...Array<string>(dots - 1).fill('..'), module),
      )
    : module
  if (!base || base.startsWith('../')) return []
  const candidates = [base + '.py', base + '.pyi', posix.join(base, '__init__.py')]
  return unique(
    [...files]
      .filter(([name]) =>
        candidates.some(
          (candidate) => name === candidate || (!dots && name.endsWith('/' + candidate)),
        ),
      )
      .map(([, file]) => file.path),
  )
}
function rust(path: string, specifier: string, files: Map<string, AnalyzedSource>) {
  const parts = specifier.split('::').filter(Boolean)
  const marker = path.lastIndexOf('src/')
  const root = marker >= 0 ? path.slice(0, marker + 3) : posix.dirname(path)
  let base = ['lib.rs', 'main.rs', 'mod.rs'].includes(posix.basename(path))
    ? posix.dirname(path)
    : path.slice(0, -3)
  if (parts[0] === 'crate') {
    base = root
    parts.shift()
  } else if (parts[0] === 'self') parts.shift()
  else if (parts[0] !== 'super') return [] // External crate resolution requires Cargo metadata.
  while (parts[0] === 'super') {
    base = posix.dirname(base)
    parts.shift()
  }
  if (parts.at(-1) === '*') parts.pop()
  const symbol = parts.at(-1)
  while (parts.length) {
    const name = posix.join(base, ...parts)
    const targets = [
      files.get(name + '.rs')?.path,
      files.get(posix.join(name, 'mod.rs'))?.path,
    ].filter((path): path is string => !!path)
    if (targets.length) return unique(targets)
    parts.pop() // An imported type/function belongs to its containing module.
  }
  return unique(
    [
      base + '.rs',
      posix.join(base, 'mod.rs'),
      posix.join(base, 'lib.rs'),
      posix.join(base, 'main.rs'),
    ].flatMap((name) => {
      const file = files.get(name)
      return file?.analysis?.declarations.includes(symbol ?? '') ? [file.path] : []
    }),
  )
}
function swiftModule(path: string) {
  const match =
    path.match(/^(.*\/(?:Sources|Tests)\/[^/]+)(?:\/|$)/) ??
    path.match(/^((?:Sources|Tests)\/[^/]+)(?:\/|$)/)
  return match?.[1] ?? posix.dirname(path)
}
function php(path: string, source: SourceAnalysis, files: Map<string, AnalyzedSource>) {
  const definitions = new Map<string, string[]>()
  for (const file of files.values()) {
    if (file.analysis?.language !== 'php') continue
    for (const declaration of file.analysis.declarations) {
      const name = [file.analysis.namespace, declaration].filter(Boolean).join('\\').toLowerCase()
      const targets = definitions.get(name) ?? []
      targets.push(file.path)
      definitions.set(name, targets)
    }
  }
  const targets = new Set<string>()
  for (const name of [...source.imports, ...source.references])
    for (const target of unique(definitions.get(name.toLowerCase()) ?? [])) targets.add(target)
  for (const suffix of source.includes ?? []) {
    const name = posix.normalize(posix.dirname(path) + suffix)
    if (name.startsWith('../')) continue
    const file = files.get(name)
    if (file) targets.add(file.path)
  }
  return [...targets]
}
function namedTypes(path: string, source: SourceAnalysis, files: Map<string, AnalyzedSource>) {
  const targets = new Set<string>()
  const definitions = [...files].filter(([, file]) => file.analysis?.language === source.language)
  for (const reference of source.references) {
    const simple = reference.split('.').at(-1) ?? reference
    const matching = definitions.filter(
      ([name, file]) =>
        file.analysis?.declarations.includes(simple) &&
        (source.language === 'swift'
          ? swiftModule(path) === swiftModule(name) ||
            source.imports.some(
              (imported) => imported.split('.')[0] === posix.basename(swiftModule(name)),
            )
          : source.language === 'go'
            ? posix.dirname(path) === posix.dirname(name) &&
              source.namespace === file.analysis.namespace
            : source.namespace === file.analysis.namespace ||
              [file.analysis.namespace, simple].filter(Boolean).join('.') === reference),
    )
    for (const target of unique(matching.map(([, file]) => file.path))) targets.add(target)
  }
  for (const imported of source.imports) {
    if (source.language === 'swift' || source.language === 'go') continue
    let name = imported
    while (name) {
      const matching = definitions.filter(([, file]) =>
        file.analysis?.declarations.some(
          (declaration) =>
            [file.analysis?.namespace, declaration].filter(Boolean).join('.') === name,
        ),
      )
      if (matching.length) {
        for (const target of unique(matching.map(([, file]) => file.path))) targets.add(target)
        break
      }
      // Wildcard/namespace imports link referenced types only, not every file in that namespace.
      const namespace = name.endsWith('.*') ? name.slice(0, -2) : name
      for (const reference of source.references) {
        const matching = definitions.filter(
          ([, file]) =>
            file.analysis?.namespace === namespace &&
            file.analysis.declarations.includes(reference),
        )
        for (const target of unique(matching.map(([, file]) => file.path))) targets.add(target)
      }
      const dot = name.lastIndexOf('.')
      if (dot < 0) break
      name = name.slice(0, dot)
    }
  }
  return [...targets]
}
export function resolveReviewLinks(
  path: string,
  source: SourceAnalysis,
  files: Map<string, AnalyzedSource>,
  goModules: { directory: string; name: string }[] = [],
) {
  if (source.language === 'javascript')
    return source.imports.flatMap((specifier) => javascript(path, specifier, files))
  if (source.language === 'python')
    return source.imports.flatMap((specifier) => python(path, specifier, files))
  if (source.language === 'rust')
    return source.imports.flatMap((specifier) => rust(path, specifier, files))
  if (source.language === 'php') return php(path, source, files)
  const targets = namedTypes(path, source, files)
  if (source.language === 'go') {
    const containing = goModules
      .filter((module) => module.directory === '.' || path.startsWith(module.directory + '/'))
      .sort((a, b) => b.directory.length - a.directory.length)[0]
    for (const imported of source.imports) {
      if (
        !containing ||
        (imported !== containing.name && !imported.startsWith(containing.name + '/'))
      )
        continue
      const directory = posix.join(containing.directory, imported.slice(containing.name.length))
      const nested = goModules.some(
        (module) =>
          module !== containing &&
          module.directory !== '.' &&
          (directory === module.directory || directory.startsWith(module.directory + '/')),
      )
      if (nested) continue // Nested modules require an explicit build-system mapping.
      targets.push(
        ...[...files]
          .filter(
            ([name, file]) =>
              file.analysis?.language === 'go' &&
              !name.endsWith('_test.go') &&
              posix.dirname(name) === directory,
          )
          .map(([, file]) => file.path),
      )
    }
  }
  return targets
}
