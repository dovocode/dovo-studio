/**
 * Unified Studio references: one paste-ready ID for anything an agent can be pointed at.
 * Form: `studio:<runtime>:<kind>:<id>` — the ID itself may contain further colons.
 * The three-part `studio:<runtime>:<id>` form is also accepted; the receiving tool
 * supplies the kind. Runtime is a studio_discover computer ID, a runtime identity,
 * or `local` for the computer the agent is running on.
 */
export type StudioReferenceKind = 'thread' | 'browser'
export type StudioReference = {
  runtimeId: string
  kind?: StudioReferenceKind
  id: string
}
const kinds: readonly string[] = ['thread', 'browser']
const segment = /^[A-Za-z0-9._-]{1,200}$/

export function studioReference(runtimeId: string, kind: StudioReferenceKind, id: string): string {
  const runtime = runtimeId.trim() || 'local'
  if (!segment.test(runtime)) throw new Error('Invalid Studio runtime ID')
  if (!id) throw new Error('Invalid Studio ID')
  return `studio:${runtime}:${kind}:${id}`
}

export function parseStudioReference(value: string): StudioReference | undefined {
  if (!value.startsWith('studio:')) return undefined
  const rest = value.slice('studio:'.length)
  const runtimeEnd = rest.indexOf(':')
  if (runtimeEnd < 1) return undefined
  const runtimeId = rest.slice(0, runtimeEnd)
  if (!segment.test(runtimeId)) return undefined
  const afterRuntime = rest.slice(runtimeEnd + 1)
  if (!afterRuntime) return undefined
  const kindEnd = afterRuntime.indexOf(':')
  if (kindEnd > 0) {
    const kind = afterRuntime.slice(0, kindEnd)
    if (kinds.includes(kind)) {
      const id = afterRuntime.slice(kindEnd + 1)
      return id ? { runtimeId, kind: kind as StudioReferenceKind, id } : undefined
    }
  }
  return { runtimeId, id: afterRuntime }
}

/** The bare ID when `value` is a Studio reference (optionally of the expected kind); else `value`. */
export function studioReferenceId(value: string, kind?: StudioReferenceKind): string {
  const reference = parseStudioReference(value)
  if (!reference || (kind && reference.kind && reference.kind !== kind)) return value
  return reference.id
}
