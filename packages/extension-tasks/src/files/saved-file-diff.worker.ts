import { parseDiffFromFile } from '@pierre/diffs'

self.onmessage = (event: MessageEvent<{ path: string; before: string; after: string }>) => {
  const { path, before, after } = event.data
  try {
    const options = { context: 4, timeout: 1000 }
    const diff = parseDiffFromFile(
      { name: path, contents: before },
      { name: path, contents: after },
      options,
      true,
    )
    self.postMessage({ diff })
  } catch {
    self.postMessage({ error: true })
  }
}
