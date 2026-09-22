import { expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { codexModels } from './codex'
it('preserves advertised reasoning and service tiers in the model catalog', async () => {
  const catalog = await codexModels({
    provider: 'codex',
    endpoint: resolve('scripts/fixtures/codex.cjs'),
    model: '',
  })
  expect(catalog.models[0]).toMatchObject({
    id: 'fixture/model',
    isDefault: true,
    reasoning: [{ id: 'high', name: 'high' }],
    serviceTiers: [{ id: 'priority', name: 'Fast' }],
  })
})
it('discovers Daybreak from the harness catalog and keeps model specialty and defaults', async () => {
  const catalog = await codexModels({
    provider: 'codex',
    endpoint: resolve('scripts/fixtures/codex.cjs'),
    model: '',
  })
  expect(catalog.codex).toEqual({ daybreakPrograms: ['daybreakBlue'], fastModeBlocked: false })
  expect(catalog.models.find((model) => model.id === 'gpt-daybreak-blue-latest')).toMatchObject({
    specialty: 'cyber',
    defaultReasoning: 'low',
    serviceTiers: [],
  })
})

it.each([
  ['chatgpt', '0.155.1', false, ['daybreakBlue'], ['fast']],
  ['chatgpt', '0.155.1', true, ['daybreakBlue'], []],
  ['apiKey', '0.155.1', false, [], ['fast']],
  ['chatgpt', '0.150.0', false, [], ['fast']],
] as const)(
  'honors login, version, and managed Fast restrictions (%s, %s, blocked=%s)',
  async (type, version, blocked, programs, tiers) => {
    const dir = await mkdtemp(join(tmpdir(), 'dovo-codex-catalog-'))
    const executable = join(dir, 'codex')
    await writeFile(
      executable,
      `#!${process.execPath}
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;
 let result={};
 if(m.method==='initialize')result={userAgent:'codex/${version}'};
 if(m.method==='account/read')result={account:{type:'${type}'}};
 if(m.method==='configRequirements/read')result={requirements:{featureRequirements:{fast_mode:${!blocked}}}};
 if(m.method==='model/list')result={data:[{model:'gpt-daybreak-blue-latest',displayName:'Daybreak Blue',description:'Cyber',isDefault:true,additionalSpeedTiers:['fast'],supportedReasoningEfforts:[]}],nextCursor:null};
 send({id:m.id,result});
});`,
      { mode: 0o700 },
    )
    try {
      const catalog = await codexModels({ provider: 'codex', endpoint: executable, model: '' })
      expect(catalog.codex?.daybreakPrograms).toEqual(programs)
      expect(catalog.codex?.fastModeBlocked).toBe(blocked)
      expect(catalog.models[0].serviceTiers?.map((tier) => tier.id)).toEqual(tiers)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
