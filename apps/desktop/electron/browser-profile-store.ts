import { constants, copyFileSync, readFileSync } from 'node:fs'

/** Damaged originals sit next to the store as `<profile>.json.damaged-<time>`. */
export const damagedBrowserStoreSuffix = '.damaged-'

/**
 * Read one browser profile JSON store. A missing file returns `undefined`. Other read errors throw,
 * because a locked or unreadable file is not damage and must stay untouched.
 *
 * A file that does not parse or decode is damaged. Its exact bytes are copied aside first, then the
 * entries that `salvage` keeps are saved in its place. If the copy fails, this throws and the
 * original stays in place, so a later save cannot replace the only copy.
 */
export function readBrowserProfileStore<A>(
  path: string,
  decode: (value: unknown) => A,
  salvage: (value: unknown) => A,
  save: (value: A) => void,
): A | undefined {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return undefined
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    value = undefined
  }
  if (value !== undefined)
    try {
      return decode(value)
    } catch {
      // Fall through to recovery.
    }
  const recovered = salvage(value)
  const backup = `${path}${damagedBrowserStoreSuffix}${Date.now()}`
  copyFileSync(path, backup, constants.COPYFILE_EXCL)
  console.error(`Recovered a damaged browser store. The original is at ${backup}.`)
  try {
    save(recovered)
  } catch (error) {
    // The recovered entries stay in memory, and the next change saves them again.
    console.error('Could not save the recovered browser store.', error)
  }
  return recovered
}
