import { expect, it, vi } from 'vite-plus/test'
import { mcpAppDownloads } from './mcp-app-downloads'
it('exports inline and server-linked resources with safe file names', async () => {
  const read = vi.fn<(uri: string) => Promise<unknown>>().mockResolvedValue({
    contents: [{ uri: 'ui://files/chart.svg', text: '<svg/>', mimeType: 'image/svg+xml' }],
  })
  const files = await mcpAppDownloads(
    {
      contents: [
        { type: 'resource', resource: { uri: 'ui://files/../report.txt', text: 'Report' } },
        { type: 'resource_link', uri: 'ui://files/chart.svg' },
      ],
    },
    read,
  )
  expect(files.map((file) => file.name)).toEqual(['report.txt', 'chart.svg'])
  expect(read).toHaveBeenCalledWith('ui://files/chart.svg')
})
it('rejects invalid encodings and oversized exports', async () => {
  await expect(
    mcpAppDownloads(
      { contents: [{ type: 'resource', resource: { blob: 'invalid!' } }] },
      vi.fn<(uri: string) => Promise<unknown>>(),
    ),
  ).rejects.toThrow('encoding')
  await expect(
    mcpAppDownloads(
      { contents: [{ type: 'resource', resource: { text: 'x'.repeat(2 * 1024 * 1024 + 1) } }] },
      vi.fn<(uri: string) => Promise<unknown>>(),
    ),
  ).rejects.toThrow('limit')
})
