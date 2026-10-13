import { readFile, chmod, rm } from 'node:fs/promises'
import { expect, it } from 'vite-plus/test'
import { providerFixture } from '../shared/provider-fixture'
import { readCodexThread } from './codex-thread'

it('reads a historical native transcript using only initialize and thread/read', async () => {
  const f = await providerFixture(
    'codex',
    `#!${process.execPath}
const fs = require('node:fs');
const record = message => { const rows = JSON.parse(fs.readFileSync(process.env.TEST_RECORD, 'utf8')); rows.push(message); fs.writeFileSync(process.env.TEST_RECORD, JSON.stringify(rows)); };
const send = message => process.stdout.write(JSON.stringify(message)+'\\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const message=JSON.parse(line);
  record(message);
  if (message.id===undefined) return;
  if (message.method==='initialize') send({id:message.id,result:{}});
  else if (message.method==='thread/read') send({id:message.id,result:{thread:{turns:[{id:'turn',items:[{id:'answer',type:'agentMessage',text:'Saved native reply'}]}]}}});
  else send({id:message.id,error:{code:-32601,message:'Unexpected mutating call'}});
});`,
  )
  await chmod(f.script, 0o700)
  try {
    expect(
      await readCodexThread({ ...f.run.agent, endpoint: f.script, args: [] }, 'child', f.cwd),
    ).toEqual([{ id: 'answer', role: 'assistant', text: 'Saved native reply' }])
    const log = await readFile(f.record, 'utf8')
    expect(log).toContain('thread/read')
    expect(log).toContain('child')
    expect(log).not.toMatch(/thread\/(?:start|resume)|turn\//)
  } finally {
    await rm(f.cwd, { recursive: true, force: true })
  }
})
