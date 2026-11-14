import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const temporary = await mkdtemp(join(tmpdir(), 'dovo-acp-updates-'))
try {
  const outfile = join(temporary, 'benchmark.mjs')
  await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'ts',
      contents: `
    import { AcpV2Updates } from './packages/runtime/src/agents/providers/acp/acp-v2-updates';
    export function measure(messages, chunks) {
      let characters = 0;
      const run = {onText(text){characters += text.length},onTextReplace(text){characters = text.length},onActivity(){},onEvent(){},onPromptAccepted(){}};
      const updates = new AcpV2Updates(run, () => {});
      const started = performance.now();
      for(let i=0;i<messages;i++) for(let j=0;j<chunks;j++) updates.accept({sessionId:'benchmark',update:{sessionUpdate:'agent_message_chunk',messageId:String(i),content:{type:'text',text:'x'.repeat(64)}}});
      return {messages,chunks,characters,milliseconds:Math.round((performance.now()-started)*100)/100};
    }
  `,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
  })
  const { measure } = await import(pathToFileURL(outfile).href)
  measure(100, 4)
  for (const messages of [500, 1000, 2000]) console.log(JSON.stringify(measure(messages, 8)))
} finally {
  await rm(temporary, { recursive: true, force: true })
}
