import type { ReviewGuide, ReviewGuideAnchor } from '@dovo/protocol'

type Lines = { lines: Map<number, string>; changed: Set<number> }
/** Read only evidenced patch lines, using the separately supplied path (never Git's escaped header). */
function patchLines(patch: string) {
  const before: Lines = { lines: new Map(), changed: new Set() }
  const after: Lines = { lines: new Map(), changed: new Set() }
  let oldLine = 0,
    newLine = 0,
    oldRemaining = 0,
    newRemaining = 0,
    inHunk = false
  for (const line of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunk) {
      oldLine = Number(hunk[1])
      oldRemaining = Number(hunk[2] ?? 1)
      newLine = Number(hunk[3])
      newRemaining = Number(hunk[4] ?? 1)
      inHunk = true
      continue
    }
    if (!inHunk || line.startsWith('\\')) continue
    const kind = line[0]
    if (kind !== ' ' && kind !== '-' && kind !== '+') {
      inHunk = false
      continue
    }
    if ((kind !== '+' && oldRemaining === 0) || (kind !== '-' && newRemaining === 0)) {
      inHunk = false
      continue
    }
    const text = line.slice(1)
    if (kind !== '+') {
      before.lines.set(oldLine, text)
      if (kind === '-') before.changed.add(oldLine)
      oldLine++
      oldRemaining--
    }
    if (kind !== '-') {
      after.lines.set(newLine, text)
      if (kind === '+') after.changed.add(newLine)
      newLine++
      newRemaining--
    }
  }
  return { before, after }
}

/** Model anchors are proposals. Only contiguous, changed lines actually sent to the model become excerpts. */
export function guideSteps(
  groups: readonly {
    label: string
    summary: string
    impact: string
    paths: string[]
    excerpts?: ReviewGuideAnchor[]
    questions?: string[]
  }[],
  evidence: readonly { path: string; evidence: string }[],
): ReviewGuide['steps'] {
  const patches = new Map(evidence.map((file) => [file.path, patchLines(file.evidence)]))
  let remaining = 128_000
  return groups.map((group) => {
    const excerpts: ReviewGuide['steps'][number]['excerpts'] = []
    for (const anchor of group.excerpts ?? []) {
      if (!group.paths.includes(anchor.path)) continue
      const side = patches.get(anchor.path)?.[anchor.side]
      if (!side) continue
      const start = Math.min(anchor.start, anchor.end)
      const limit = Math.min(Math.max(anchor.start, anchor.end), start + 39)
      const lines: string[] = []
      let size = 0,
        changed = false
      for (let line = start; line <= limit; line++) {
        const text = side.lines.get(line)
        if (text === undefined || size + text.length + 1 > Math.min(16_000, remaining)) break
        lines.push(text)
        size += text.length + 1
        changed ||= side.changed.has(line)
      }
      if (!lines.length || !changed) continue
      remaining -= size
      excerpts.push({
        path: anchor.path,
        side: anchor.side,
        start,
        end: start + lines.length - 1,
        text: lines.join('\n'),
      })
    }
    return {
      title: group.label,
      summary: group.summary,
      impact: group.impact,
      paths: group.paths,
      excerpts,
      questions: group.questions ?? [],
    }
  })
}
