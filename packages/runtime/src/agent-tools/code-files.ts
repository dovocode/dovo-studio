import { isUtf8 } from 'node:buffer'
import { readBoundedFile } from '../storage/read-bounded-file.js'
import { z } from 'zod'
import { open, lstat } from 'node:fs/promises'
import { runClientEffect } from '@dovo/client-runtime'
import { constants } from 'node:fs'
import { effectivePermissionPolicy, samePermissionPolicy, resolveTaskAgent } from '@dovo/protocol'
import type { Services } from '../services.js'
import type { RunPolicy } from '../auth/run-credentials.js'
import { repositoryPath, safeFile } from '../scm/repositories/paths.js'
import { openContainedPreview } from '../scm/repositories/file-preview-open.js'
import { withFileWrite } from '../scm/repositories/file-writes.js'
import { HttpError, runtimeOperation } from '../errors.js'

const path = z.string().min(1).max(4000)
const scope = { checkoutId: z.string().max(200).optional() }
const schemas = {
  read_file: z
    .object({
      ...scope,
      path,
      startLine: z.number().int().min(1).optional(),
      maxLines: z.number().int().min(1).max(5000).optional(),
    })
    .strict(),
  write_file: z
    .object({
      ...scope,
      path,
      contents: z.string().max(1024 * 1024),
      expectedContents: z
        .string()
        .max(1024 * 1024)
        .nullable(),
    })
    .strict(),
  edit: z
    .object({
      ...scope,
      path,
      oldText: z
        .string()
        .min(1)
        .max(1024 * 1024),
      newText: z.string().max(1024 * 1024),
    })
    .strict(),
  list_files: z
    .object({
      ...scope,
      directory: z.string().max(4000).optional(),
      cursor: z.string().max(100).optional(),
    })
    .strict(),
  search: z
    .object({
      ...scope,
      query: z.string().min(1).max(256),
      kind: z.enum(['content', 'paths']).optional(),
    })
    .strict(),
}
const descriptions = {
  read_file: 'Read a contained text file. Optional line range. Maximum 1 MB.',
  write_file:
    'Create or replace a contained text file. Pass its exact prior contents, or null to create. Uses edit permissions and conflict checks.',
  edit: 'Replace one exact occurrence of oldText in a contained text file. Empty newText deletes it. Missing or repeated text stops the edit.',
  list_files:
    'List one directory in the run checkout or a linked checkout. Returns a bounded page and cursor.',
  search: 'Search file content or paths in the run checkout or an inherited linked checkout.',
}
const fileToolName = z.enum(['read_file', 'write_file', 'edit', 'list_files', 'search'])
export const codeFileTools = fileToolName.options.map((name) => ({
  source: 'harness',
  origin: 'studio-equivalent',
  name,
  description: descriptions[name],
  inputSchema: z.toJSONSchema(schemas[name]),
}))
export async function codeFileCall(
  s: Services,
  grant: RunPolicy,
  name: string,
  input: unknown,
  signal: AbortSignal,
  authorize: () => void,
) {
  if (!Object.hasOwn(schemas, name)) throw new HttpError(404, 'Unknown harness file tool')
  const key = fileToolName.parse(name)
  const args = schemas[key].parse(input ?? {})
  const captured = grant.codeDirectories
  if (!captured)
    throw new HttpError(409, 'File tools are unavailable until the provider turn is ready')
  const link = args.checkoutId
    ? captured.linked.find((link) => link.id === args.checkoutId)
    : undefined
  if (args.checkoutId && !link)
    throw new HttpError(403, 'Linked checkout is outside this run snapshot')
  const check = () => {
    authorize()
    signal.throwIfAborted()
    const task = s.store.taskSummary(grant.taskId)
    const agent = resolveTaskAgent(task, s.store.get().agents)
    if (!agent || !samePermissionPolicy(grant.permissions, agent))
      throw new HttpError(403, 'Agent access changed. Start a new turn.')
    if (
      link &&
      !task.linkedCheckouts?.some(
        (current) =>
          current.id === link.id &&
          current.repositoryId === link.repositoryId &&
          current.access === link.access,
      )
    )
      throw new HttpError(403, 'Linked checkout access changed')
  }
  check()
  const root = await repositoryPath(link?.path ?? captured.cwd)
  const repo = s.store
    .get()
    .repositories.find(
      (repo) => repo.id === (link?.repositoryId ?? s.store.taskSummary(grant.taskId).repositoryId),
    )
  const plain = !!repo?.kind
  if (key === 'list_files') {
    const args = schemas.list_files.parse(input ?? {})
    const result = await s.projectFiles.directory(root, args.directory, args.cursor, plain, signal)
    check()
    return result
  }
  if (key === 'search') {
    const args = schemas.search.parse(input ?? {})
    const result = await (args.kind === 'paths'
      ? s.projectFiles.pathSearch(root, args.query, plain)
      : s.projectFiles.contentSearch(root, args.query, plain, signal))
    check()
    return result
  }
  if (key === 'read_file') {
    const args = schemas.read_file.parse(input)
    const { handle } = await openContainedPreview(root, args.path)
    try {
      if ((await handle.stat()).size > 1024 * 1024)
        throw new HttpError(413, 'Text file exceeds 1 MB')
      const bytes = await readBoundedFile(handle, 1024 * 1024)
      if (!isUtf8(bytes)) throw new HttpError(415, 'Choose a UTF-8 text file')
      const contents = bytes.toString('utf8')
      check()
      if (Buffer.byteLength(contents) > 1024 * 1024)
        throw new HttpError(413, 'Text file exceeds 1 MB')
      if (contents.includes('\0')) throw new HttpError(415, 'Choose a text file')
      const lines = contents.split('\n'),
        start = args.startLine ?? 1
      return {
        path: args.path,
        startLine: start,
        totalLines: lines.length,
        contents: lines.slice(start - 1, start - 1 + (args.maxLines ?? lines.length)).join('\n'),
      }
    } finally {
      await handle.close()
    }
  }
  const change =
    key === 'edit'
      ? { kind: 'edit' as const, args: schemas.edit.parse(input) }
      : { kind: 'write' as const, args: schemas.write_file.parse(input) }
  const policy = effectivePermissionPolicy(grant.permissions)
  if (grant.readOnly || policy.readOnly || link?.access === 'read-only')
    throw new HttpError(403, 'File edits are disabled in this scope')
  const checkContents = (text: string) => {
    if (text.includes('\0') || Buffer.byteLength(text) > 1024 * 1024)
      throw new HttpError(413, 'Choose a text file up to 1 MB')
  }
  checkContents(change.kind === 'edit' ? change.args.newText : change.args.contents)
  const filename = await safeFile(root, change.args.path)
  if (
    policy.approvalPolicy !== 'never' &&
    !policy.autoAcceptEdits &&
    (await s.approvals.request(
      grant.taskId,
      change.kind === 'edit' ? 'Code mode edit file' : 'Code mode write file',
      JSON.stringify(change.args),
      signal,
    )) === 'deny'
  )
    throw new HttpError(403, 'File edit declined')
  check()
  return runClientEffect(
    s.tasks.withCheckoutEditEffect(
      root,
      runtimeOperation(() =>
        withFileWrite(filename, async () => {
          check()
          const target = await safeFile(root, change.args.path)
          let contents: string
          if (change.kind === 'write' && change.args.expectedContents === null) {
            contents = change.args.contents
            const handle = await open(
              target,
              constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
              0o644,
            )
            try {
              await handle.writeFile(contents, 'utf8')
            } finally {
              await handle.close()
            }
          } else {
            const before = await lstat(target)
            if (!before.isFile() || before.size > 1024 * 1024)
              throw new HttpError(400, 'Choose a regular text file up to 1 MB')
            const handle = await open(
              target,
              constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
            )
            try {
              const opened = await handle.stat(),
                currentPath = await safeFile(root, change.args.path),
                after = await lstat(currentPath)
              if (
                !opened.isFile() ||
                opened.dev !== before.dev ||
                opened.ino !== before.ino ||
                after.dev !== opened.dev ||
                after.ino !== opened.ino
              )
                throw new HttpError(409, 'File changed while opening it')
              const bytesBefore = await readBoundedFile(handle, 1024 * 1024)
              if (!isUtf8(bytesBefore)) throw new HttpError(415, 'Choose a UTF-8 text file')
              const current = bytesBefore.toString('utf8')
              if (current.includes('\0')) throw new HttpError(415, 'Choose a text file')
              if (change.kind === 'edit') {
                const { oldText, newText } = change.args
                const match = current.indexOf(oldText)
                if (match < 0 || current.includes(oldText, match + 1))
                  throw new HttpError(
                    409,
                    'oldText must occur exactly once. Read the file and use more context.',
                  )
                contents = current.slice(0, match) + newText + current.slice(match + oldText.length)
                checkContents(contents)
              } else {
                if (current !== change.args.expectedContents)
                  throw new HttpError(409, 'File changed. Read it before editing again.')
                contents = change.args.contents
              }
              check()
              const bytes = Buffer.from(contents)
              let offset = 0
              while (offset < bytes.length) {
                const { bytesWritten } = await handle.write(
                  bytes,
                  offset,
                  bytes.length - offset,
                  offset,
                )
                if (!bytesWritten) throw new Error('Could not write file')
                offset += bytesWritten
              }
              await handle.truncate(bytes.length)
            } finally {
              await handle.close()
            }
          }
          return { path: change.args.path, bytes: Buffer.byteLength(contents) }
        }),
      ),
    ),
  )
}
