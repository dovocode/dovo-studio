import { expect, it } from 'vite-plus/test'
import { writeFile, readFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { fixture } from '../testing/fixture.js'
import { startRuntime } from '../index.js'
import { spreadsheetPreview } from '../scm/repositories/spreadsheet-preview.js'

it('previews real workbooks over HTTP and keeps formulas and files unchanged', async () => {
  const f = await fixture(),
    token = 'spreadsheet-test-token'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    runtime.services.store.update(() => f.workspace)
    const task = runtime.services.tasks.create({
      title: 'Sheet',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: '',
      execution: 'main',
    })
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['Name', 'Value'],
        ['A', '<script>alert(1)</script>'],
        ['B', '=SUM(1,2)'],
      ]),
      'Data',
    )
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet(Array.from({ length: 230 }, (_, i) => [i, 'x'])),
      'Large',
    )
    const data: Buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
    const path = join(f.directory, 'test.xlsx')
    await writeFile(path, data)
    const call = (path: string, sheet?: string) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/files/spreadsheet`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, path, sheet }),
      })
    const result = await call('test.xlsx')
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({
      sheets: ['Data', 'Large'],
      sheet: 'Data',
      truncated: false,
      rows: [
        ['Name', 'Value'],
        ['A', '<script>alert(1)</script>'],
        ['B', '=SUM(1,2)'],
      ],
    })
    const large = await call('test.xlsx', 'Large')
    const value = await large.json()
    expect(value.rows).toHaveLength(200)
    expect(value.truncated).toBe(true)
    expect((await call('test.xlsx', 'Missing')).status).toBe(422)
    expect((await call('../test.xlsx')).status).not.toBe(200)
    await symlink('/etc/passwd', join(f.directory, 'outside.csv'))
    expect((await call('outside.csv')).status).not.toBe(200)
    expect(await readFile(path)).toEqual(data)
  } finally {
    await runtime.close()
    await f.cleanup()
  }
})
it('reads quoted CSV, bounds cells, and rejects oversized files before starting a worker', async () => {
  const value = await spreadsheetPreview(Buffer.from('name,value\n"a,b","two\nlines"\n'))
  expect(value.rows.slice(0, 2)).toEqual([
    ['name', 'value'],
    ['a,b', 'two\nlines'],
  ])
  expect(() => spreadsheetPreview(new Uint8Array(8 * 1024 * 1024 + 1))).toThrow('8 MB')
})
