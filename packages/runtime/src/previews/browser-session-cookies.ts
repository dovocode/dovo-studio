import { Schema } from 'effect'
import type { BrowserContext, Cookie } from 'playwright'
import { readFile, rm, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const cookiesSchema = Schema.Array(
  Schema.Struct({
    name: Schema.String,
    value: Schema.String,
    domain: Schema.String,
    path: Schema.String,
    expires: Schema.Literal(-1),
    secure: Schema.Boolean,
    httpOnly: Schema.Boolean,
    sameSite: Schema.Literals(['Strict', 'Lax', 'None']),
    partitionKey: Schema.optional(Schema.String),
  }),
)
const identity = (cookie: Cookie) =>
  JSON.stringify([cookie.domain, cookie.path, cookie.name, cookie.partitionKey])

/** Consume a clean-close snapshot; a crashed context cannot replay an older login. */
export async function restoreBrowserSessionCookies(context: BrowserContext, directory: string) {
  const path = join(directory, 'dovo-session-cookies.json')
  let cookies: readonly Cookie[]
  try {
    cookies = Schema.decodeUnknownSync(cookiesSchema)(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return
    throw new Error('Could not read saved browser session cookies.')
  }
  await rm(path)
  const existing = new Set((await context.cookies()).map(identity))
  await context.addCookies(cookies.filter((cookie) => !existing.has(identity(cookie))))
}

export async function saveBrowserSessionCookies(context: BrowserContext, directory: string) {
  const path = join(directory, 'dovo-session-cookies.json')
  const cookies = (await context.cookies()).filter((cookie) => cookie.expires === -1)
  if (!cookies.length) {
    await rm(path, { force: true })
    return
  }
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    // Runtime Chromium already stores profile cookies locally; match its file protection.
    await writeFile(temporary, JSON.stringify(cookies), { mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function clearBrowserSessionCookies(directory: string) {
  await rm(join(directory, 'dovo-session-cookies.json'), { force: true })
}
