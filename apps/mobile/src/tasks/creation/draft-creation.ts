/** One attempt survives workspace refreshes; only an explicit retry starts another request. */
export function createDraftCreation() {
  let current: { key: string; result: Promise<void> } | undefined
  return (key: string, create: () => Promise<unknown>): Promise<void> => {
    if (current?.key === key) return current.result
    const result = Promise.resolve()
      .then(create)
      .then(() => undefined)
    current = { key, result }
    return result
  }
}

/** Both callbacks are captured before creation starts, and a destination change fences the upload. */
export async function transferSharedDraft<T>({
  create,
  upload,
  files,
  signal,
}: {
  create: () => Promise<void>
  upload: (files: T[], signal: AbortSignal, requireCommitted: boolean) => Promise<void>
  files: T[]
  signal: AbortSignal
}): Promise<void> {
  if (signal.aborted)
    throw new Error('The draft destination changed. Choose the destination again.')
  await create()
  if (signal.aborted)
    throw new Error('The draft destination changed. Choose the destination again.')
  if (files.length) await upload(files, signal, true)
}
