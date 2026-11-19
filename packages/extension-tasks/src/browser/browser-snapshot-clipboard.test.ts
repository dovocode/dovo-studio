import { afterEach, expect, it, vi } from 'vite-plus/test'
import { browserSnapshotPaste, copyBrowserSnapshot } from './browser-snapshot-clipboard'

afterEach(() => vi.unstubAllGlobals())

it('copies binary image data and pastes its source in the same attachment batch', async () => {
  class ClipboardItemFixture {
    constructor(readonly formats: Record<string, Blob | Promise<Blob>>) {}
  }
  const write = vi
    .fn<(items: ClipboardItemFixture[]) => Promise<void>>()
    .mockResolvedValue(undefined)
  vi.stubGlobal('ClipboardItem', ClipboardItemFixture)
  vi.stubGlobal('navigator', { clipboard: { write } })
  await copyBrowserSnapshot(async () => 'data:image/png;base64,YWJj', {
    url: 'http://localhost:3000/path?a=1',
    title: 'Preview',
  })
  const { formats } = write.mock.calls[0][0][0]
  const png = await formats['image/png']
  const source = await (await formats['text/plain']).text()
  const files = browserSnapshotPaste([new File([png], 'image.png', { type: 'image/png' })], source)
  expect(files).toHaveLength(2)
  if (!files) throw new Error('Missing snapshot paste')
  expect(await files[0].text()).toBe('abc')
  expect(await files[1].text()).toContain('Page: Preview\nURL: http://localhost:3000/path?a=1')
  expect(await files[1].text()).toContain(`Image: ${files[0].name}`)
})

it('keeps an ordinary image unchanged when clipboard text is unrelated', () => {
  const files = [new File(['abc'], 'image.png', { type: 'image/png' })]
  expect(browserSnapshotPaste(files, 'some other application')).toBeUndefined()
})

it('can copy and paste a snapshot without the secure-context Clipboard API', async () => {
  const copy = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined)
  vi.stubGlobal('window', { dovoCopyText: copy })
  vi.stubGlobal('navigator', {})
  await copyBrowserSnapshot(async () => 'data:image/png;base64,YWJj', {
    url: 'http://lan.example:3000',
    title: 'LAN preview',
  })
  const paste = browserSnapshotPaste([], copy.mock.calls[0][0])
  expect(paste).toHaveLength(2)
  expect(await paste?.[0].text()).toBe('abc')
  expect(await paste?.[1].text()).toContain('URL: http://lan.example:3000/')
})
