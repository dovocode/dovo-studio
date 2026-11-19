type Manifest = Record<string, unknown>

export function extensionVersion(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){0,3}$/.test(value) ||
    value.split('.').some((part) => Number(part) > 65535) ||
    !/[1-9]/.test(value)
  )
    throw new Error('Invalid Chrome extension version.')
  return value
}

export function compareExtensionVersions(left: unknown, right: unknown): number {
  const a = extensionVersion(left).split('.').map(Number)
  const b = extensionVersion(right).split('.').map(Number)
  for (let i = 0; i < 4; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

// Ignore the packaged script filenames. Compare every scope restriction, including
// exclusions, frame flags, and fields introduced by later Chromium versions.
function scriptScopes(manifest: Manifest) {
  return Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts.map((script: unknown) => {
        if (!script || typeof script !== 'object') return JSON.stringify(script)
        return JSON.stringify(
          Object.entries(script)
            .filter(([key]) => key !== 'js' && key !== 'css')
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => [
              key,
              Array.isArray(value)
                ? [...value].sort((a, b) => String(a).localeCompare(String(b)))
                : value,
            ]),
        )
      })
    : []
}

/** Be conservative when access changes. Optional-to-required promotions also need review. */
export function changedExtensionAccess(previous: Manifest, candidate: Manifest): string[] {
  const changes: string[] = []
  for (const [key, label] of [
    ['permissions', 'Permission'],
    ['optional_permissions', 'Optional permission'],
    ['host_permissions', 'Website access'],
    ['optional_host_permissions', 'Optional website access'],
  ] as const) {
    const oldValues = previous[key]
    const newValues = candidate[key]
    const approved = new Set(
      Array.isArray(oldValues) ? oldValues.map((v) => JSON.stringify(v)) : [],
    )
    if (Array.isArray(newValues))
      for (const value of newValues) {
        if (!approved.has(JSON.stringify(value)))
          changes.push(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      }
  }
  const previousScripts = new Set(scriptScopes(previous))
  if (scriptScopes(candidate).some((scope) => !previousScripts.has(scope)))
    changes.push('Page scripts can run on new pages, in new frames or under changed conditions.')
  for (const [key, label] of [
    ['externally_connectable', 'Sites and extensions that can send messages'],
    ['web_accessible_resources', 'Extension resources available to websites'],
    ['oauth2', 'OAuth account access'],
  ] as const) {
    // These declarations grant access outside the normal permissions arrays.
    // Removing externally_connectable restores Chrome's default extension callers.
    if (
      (candidate[key] !== undefined ||
        (key === 'externally_connectable' && previous[key] !== undefined)) &&
      JSON.stringify(candidate[key]) !== JSON.stringify(previous[key])
    )
      changes.push(
        `${label}: ${candidate[key] === undefined ? 'Chromium default' : JSON.stringify(candidate[key])}`,
      )
  }
  return changes
}

/** Reloading starts Electron's permission adapter with the new manifest's required grants. */
export function changedRuntimeGrants(
  previous: Manifest,
  candidate: Manifest,
  granted: { permissions?: string[]; origins?: string[] } | undefined,
): string[] {
  if (!granted)
    return [
      'Current extension permissions could not be read. Loading this version will reset them.',
    ]
  const changes: string[] = []
  for (const [key, effective] of [
    ['permissions', granted.permissions],
    ['host_permissions', granted.origins],
  ] as const) {
    const before = Array.isArray(previous[key]) ? previous[key] : []
    const after = Array.isArray(candidate[key]) ? candidate[key] : []
    for (const item of before)
      if (after.includes(item) && !effective?.includes(item))
        changes.push(`Previously removed access will be granted again: ${item}`)
    for (const item of effective ?? [])
      if (!before.includes(item) && !after.includes(item))
        changes.push(`Optional access will need approval again: ${item}`)
  }
  return changes
}
