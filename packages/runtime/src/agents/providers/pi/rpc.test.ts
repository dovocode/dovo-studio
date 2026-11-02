import { afterEach, expect, it } from 'vite-plus/test'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PiRpc } from './rpc.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })),
  )
})

it('correlates Pi JSONL responses and delivers events while keeping Unicode separators intact', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dovo-pi-rpc-'))
  directories.push(dir)
  const script = join(dir, 'server.cjs')
  await fs.writeFile(
    script,
    `let buffer=''; process.stdin.on('data', chunk => { buffer += chunk; let i; while ((i=buffer.indexOf('\\n')) >= 0) { const line=buffer.slice(0,i); buffer=buffer.slice(i+1); const command=JSON.parse(line); process.stdout.write(JSON.stringify({type:'message_update', text:'a\\u2028b'})+'\\n'); process.stdout.write(JSON.stringify({type:'response', id:command.id, success:true, data:{command:command.type}})+'\\n'); } });`,
  )
  const rpc = new PiRpc(process.execPath, [script], dir, process.env)
  const events: unknown[] = []
  rpc.onEvent((event) => events.push(event))
  try {
    const result = await rpc.request({ type: 'get_state' }, new AbortController().signal)
    expect(result.data).toEqual({ command: 'get_state' })
    expect(events).toEqual([{ type: 'message_update', text: 'a\u2028b' }])
  } finally {
    await rpc.close()
  }
})
