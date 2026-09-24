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
