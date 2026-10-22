/** Resolve API, file and stream paths with the same credential/origin boundary. */
export function runtimeUrl(address: string, path: string) {
  const base = new URL(address)
  const target = new URL(path, base)
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    target.origin !== base.origin ||
    target.username ||
    target.password
  )
    throw new Error('Runtime URLs must stay on their selected origin')
  return target
}
