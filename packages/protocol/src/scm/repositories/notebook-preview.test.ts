import { expect, it } from 'vite-plus/test'
import { notebookMarkdown } from './notebook-preview.js'
import { projectFilePath } from './project-browser.js'
import { attachmentTextPreview } from '../../shared/attachments.js'

it('renders Markdown-only notebook output and treats source and streams as code', () => {
  expect(
    notebookMarkdown(
      JSON.stringify({
        nbformat: 4,
        cells: [
          { cell_type: 'markdown', source: ['# Report\n', 'Context'] },
          {
            cell_type: 'code',
            source: 'print("~~~")',
            outputs: [
              { data: { 'text/markdown': ['**Ready**\n'], 'text/plain': 'fallback' } },
              { text: ['printed\n', 'done'] },
              { data: { 'text/html': '<script>ignored</script>' } },
            ],
          },
        ],
      }),
    ),
  ).toBe('# Report\nContext\n\n~~~~\nprint("~~~")\n~~~~\n\n**Ready**\n\n\n~~~\nprinted\ndone\n~~~')
  expect(notebookMarkdown('{"cells":')).toBeUndefined()
})

it('renders notebook attachment output as Markdown and keeps normal text as source', () => {
  const data = btoa(
    JSON.stringify({
      nbformat: 4,
      cells: [
        { cell_type: 'code', outputs: [{ data: { 'text/markdown': '**Notebook ready**' } }] },
      ],
    }),
  )
  expect(attachmentTextPreview('stored.IPYNB', data)).toEqual({
    markdown: true,
    text: '**Notebook ready**',
  })
  expect(attachmentTextPreview('note.txt', btoa('**Text**'))).toEqual({
    markdown: false,
    text: '**Text**',
  })
  expect(attachmentTextPreview('binary.bin', btoa('\0'))).toBeUndefined()
})

it('copies paths using the runtime filesystem syntax, with a relative fallback', () => {
  expect(projectFilePath('/work/project', 'notes/a file.md')).toBe('/work/project/notes/a file.md')
  expect(projectFilePath('C:\\Project\\', 'notes/a.md')).toBe('C:\\Project\\notes\\a.md')
  expect(projectFilePath('\\\\server\\share', 'x/a.md')).toBe('\\\\server\\share\\x\\a.md')
  expect(projectFilePath(undefined, 'x/a.md')).toBe('x/a.md')
})
