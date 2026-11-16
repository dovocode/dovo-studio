import { readBoundedFile } from '../storage/read-bounded-file.js'
import type { Services } from '../services.js'
import type { RunPolicy } from '../auth/run-credentials.js'
import { HttpError } from '../errors.js'
import { checkCodeAccess } from '../agent-tools/code-access.js'
import { repositoryPath } from '../scm/repositories/paths.js'
import { openContainedPreview } from '../scm/repositories/file-preview-open.js'
import { visionSchema } from './schema.js'
import { analyzeMirage } from './mirage.js'

export async function visionTool(
  s: Services,
  grant: RunPolicy,
  value: unknown,
  signal: AbortSignal,
  authorize: () => void,
) {
  const input = visionSchema.parse(value)
  const check = () => {
    authorize()
    signal.throwIfAborted()
    return checkCodeAccess(s.store, grant)
  }
  const captured = check()
  const image = input.image
  let bytes: Buffer
  if ('data' in image) {
    bytes = Buffer.from(image.data, 'base64')
    if (bytes.toString('base64') !== image.data)
      throw new HttpError(400, 'Choose base64 image data')
  } else if ('attachmentId' in image) {
    const file = s.attachments.read(grant.taskId, image.attachmentId)
    bytes = Buffer.from(file.data, 'base64')
  } else {
    const link = image.checkoutId
      ? captured.linked.find((link) => link.id === image.checkoutId)
      : undefined
    if (image.checkoutId && !link)
      throw new HttpError(403, 'Linked checkout is outside this run snapshot')
    if (
      link &&
      !s.store
        .taskSummary(grant.taskId)
        .linkedCheckouts?.some(
          (current) =>
            current.id === link.id &&
            current.repositoryId === link.repositoryId &&
            current.access === link.access,
        )
    )
      throw new HttpError(403, 'Linked checkout access changed')
    const root = await repositoryPath(link?.path ?? captured.cwd)
    const { handle } = await openContainedPreview(root, image.path)
    try {
      const limit = 16 * 1024 * 1024
      if ((await handle.stat()).size > limit)
        throw new HttpError(413, 'Choose an image up to 16 MB')
      bytes = await readBoundedFile(handle, limit)
    } finally {
      await handle.close()
    }
  }
  check()
  const result = await analyzeMirage(bytes, input, signal)
  check()
  return result
}
