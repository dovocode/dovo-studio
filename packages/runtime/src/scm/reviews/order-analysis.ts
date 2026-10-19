import { analyzeReviewSource } from './languages.js'
import { resolveReviewLinks, type AnalyzedSource } from './resolve.js'
import { posix } from 'node:path'
import { folderFileGroups, type ReviewSource, type ReviewModule } from './order-input.js'
import type { ReviewGroup } from '@dovo/protocol'

/** Import relationships come from syntax trees of both versions, including deleted imports. */
export async function relatedFileGroups(
  files: ReviewSource[],
  modules: ReviewModule[] = [],
): Promise<ReviewGroup[]> {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  const afterPaths = new Map<string, string>()
  const beforePaths = new Map<string, string>()
  for (const file of sorted) {
    afterPaths.set(file.path, file.path)
    if (!file.previousPath) beforePaths.set(file.path, file.path)
  }
  for (const file of sorted) if (file.previousPath) beforePaths.set(file.previousPath, file.path)
  const dependencies = new Map(sorted.map((file) => [file.path, new Set<string>()]))
  const neighbours = new Map(sorted.map((file) => [file.path, new Set<string>()]))
  const link = (dependent: string, dependency: string) => {
    if (dependency === dependent) return
    dependencies.get(dependent)?.add(dependency)
    neighbours.get(dependent)?.add(dependency)
    neighbours.get(dependency)?.add(dependent)
  }
  // Analyze each version separately: a reused renamed path must not change old imports.
  for (const side of ['before', 'after'] as const) {
    const manifests = new Map(
      [...modules, ...files.filter((file) => posix.basename(file.path) === 'go.mod')].map(
        (file) => [file.path, file],
      ),
    )
    const goModules = [...manifests.values()].flatMap((file) => {
      const module = file[side]?.match(/^\s*module\s+(?:"([^"]+)"|(\S+))/m)
      const name = module?.[1] ?? module?.[2]
      return name ? [{ directory: posix.dirname(file.path), name }] : []
    })
    const byPath = side === 'before' ? beforePaths : afterPaths
    const analyzed = new Map<string, AnalyzedSource>()
    for (const file of sorted) {
      const path = side === 'before' ? (file.previousPath ?? file.path) : file.path
      const source = file[side]
      if (byPath.get(path) !== file.path) continue
      analyzed.set(path, {
        path: file.path,
        analysis: source === undefined ? null : await analyzeReviewSource(path, source),
      })
    }
    for (const [path, file] of analyzed)
      if (file.analysis)
        for (const dependency of resolveReviewLinks(path, file.analysis, analyzed, goModules))
          link(file.path, dependency)
  }
  const visited = new Set<string>()
  const groups: ReviewGroup[] = []
  for (const file of sorted) {
    if (visited.has(file.path) || !neighbours.get(file.path)?.size) continue
    const component = new Set<string>()
    const collect = (path: string) => {
      if (component.has(path)) return
      component.add(path)
      for (const other of neighbours.get(path) ?? []) collect(other)
    }
    collect(file.path)
    const ordered: string[] = [],
      active = new Set<string>()
    const visit = (path: string) => {
      if (visited.has(path) || active.has(path)) return // Cycles retain deterministic path order.
      active.add(path)
      for (const dependency of [...(dependencies.get(path) ?? [])].sort()) visit(dependency)
      active.delete(path)
      visited.add(path)
      ordered.push(path)
    }
    for (const path of [...component].sort()) visit(path)
    groups.push({ label: ordered[0] ?? file.path, paths: ordered, basis: 'ast' })
  }
  groups.push(...folderFileGroups(sorted.filter((file) => !visited.has(file.path))))
  return groups
}
