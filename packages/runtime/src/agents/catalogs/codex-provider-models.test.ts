/// <reference types="node" />
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentDiscovery } from '@dovo/protocol'
import { codexModels } from './codex.js'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})
const original = {
  id: 'gpt-5.6-terra',
  name: 'GPT-5.6 Terra',
  isDefault: true,
  reasoning: [{ id: 'high', name: 'high' }],
  serviceTiers: [{ id: 'priority', name: 'Priority' }],
}
async function fixture() {
  const fetch = globalThis.fetch
  let metadataStatus = 200
  let metadata: unknown = { models: [] }
  const metadataRequests: { url: string; init: RequestInit }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (href.startsWith('https://raw.githubusercontent.com/')) {
      metadataRequests.push({ url: href, init: init ?? {} })
      return Promise.resolve(new Response(JSON.stringify(metadata), { status: metadataStatus }))
    }
    return fetch(url, init)
  })
  const dir = await mkdtemp(join(tmpdir(), 'dovo-codex-provider-'))
  const requests: { url: string; authorization?: string; profile?: string }[] = []
  let status = 200
  let body: unknown = {
    data: [
      { id: 'gpt-6.1-terra' },
      { id: 'gpt-6.1-terra' },
      { id: 'gpt-5.6-terra', name: 'Incorrect replacement' },
      { id: 'gpt-image-2' },
      { id: 'claude-opus-5-5' },
      { id: 'gpt-4o-audio-preview' },
    ],
  }
  const server = createServer((req, res) => {
    requests.push({
      url: req.url ?? '',
      authorization: req.headers.authorization,
      profile: typeof req.headers['x-profile'] === 'string' ? req.headers['x-profile'] : undefined,
    })
    res.writeHead(status, { 'Content-Type': 'application/json', Location: '/redirected' })
    res.end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const executable = join(dir, 'codex')
  await writeFile(
    executable,
    String.raw`#!${process.execPath}
const send=result=>process.stdout.write(JSON.stringify(result)+'\n');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;
 let result={};
 if(m.method==='initialize')result={userAgent:'codex/0.164.0'};
 if(m.method==='account/read')result={account:{type:'apiKey'}};
 if(m.method==='config/read'){
  if(process.env.FIXTURE_OLD_CODEX==='1')return send({id:m.id,error:{code:-32601,message:'Method not found'}});
  result={config:JSON.parse(process.env.FIXTURE_CODEX_CONFIG)};
 }
 if(m.method==='model/list')result={data:[{
  model:'gpt-5.6-terra',displayName:'GPT-5.6 Terra',description:'Native metadata',isDefault:true,
  supportedReasoningEfforts:[{reasoningEffort:'high',description:'High'}],
  serviceTiers:[{id:'priority',name:'Priority'}]
 }],nextCursor:null};
 send({id:m.id,result});
});`,
    { mode: 0o700 },
  )
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    await rm(dir, { recursive: true, force: true })
  })
  const provider: Record<string, unknown> = {
    base_url: `http://127.0.0.1:${address.port}/v1`,
    env_key: 'FIXTURE_PROVIDER_KEY',
  }
  const config: Record<string, unknown> = {
    model_provider: 'proxy',
    model_providers: { proxy: provider },
  }
  const env: Record<string, string> = {
    FIXTURE_PROVIDER_KEY: 'fixture-key',
    CODEX_HOME: join(dir, 'account'),
  }
  const load = () =>
    codexModels({
      provider: 'codex',
      endpoint: executable,
      model: '',
      env: { ...env, FIXTURE_CODEX_CONFIG: JSON.stringify(config) },
    } satisfies AgentDiscovery)
  return {
    dir,
    provider,
    config,
    env,
    requests,
    metadataRequests,
    metadata: (value: unknown, status = 200) => {
      metadata = value
      metadataStatus = status
    },
    load,
    reply: (code: number, value: unknown) => {
      status = code
      body = value
    },
  }
}

it('discovers Terra as a normal model from the configured provider and preserves native metadata', async () => {
  const f = await fixture()
  const catalog = await f.load()
  expect(f.requests).toEqual([
    { url: '/v1/models', authorization: 'Bearer fixture-key', profile: undefined },
  ])
  expect(catalog.models).toHaveLength(2)
  expect(catalog.models[0]).toMatchObject(original)
  expect(catalog.models[1]).toEqual({
    id: 'gpt-6.1-terra',
    name: '6.1 Terra',
    reasoning: [],
    serviceTiers: [],
  })
})

it('adds exact upstream reasoning metadata without forwarding provider credentials or changing native models', async () => {
  const f = await fixture()
  const levels = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
  f.metadata({
    models: [
      {
        slug: 'gpt-6.1-terra',
        default_reasoning_level: 'low',
        supported_reasoning_levels: levels.map((effort) => ({ effort })),
      },
      {
        slug: original.id,
        default_reasoning_level: 'low',
        supported_reasoning_levels: [{ effort: 'low' }],
      },
      {
        slug: 'gpt-6.2-terra',
        default_reasoning_level: 'high',
        supported_reasoning_levels: [{ effort: 'high' }],
      },
    ],
  })
  const catalog = await f.load()
  expect(catalog.models[0]).toMatchObject(original)
  expect(catalog.models[1]).toMatchObject({
    id: 'gpt-6.1-terra',
    reasoning: levels.map((id) => ({ id, name: id })),
    defaultReasoning: 'low',
    serviceTiers: [],
  })
  expect(catalog.models).toHaveLength(2)
  expect(f.metadataRequests).toHaveLength(1)
  expect(f.metadataRequests[0]?.url).toBe(
    'https://raw.githubusercontent.com/openai/codex/main/codex-rs/models-manager/models.json',
  )
  const request = f.metadataRequests[0]!.init
  expect([...new Headers(request.headers).entries()]).toEqual([['accept', 'application/json']])
  expect(request.redirect).toBe('error')
})

it('does not infer reasoning from a different model or advertise an unsupported default', async () => {
  const f = await fixture()
  f.metadata({
    models: [
      {
        slug: 'gpt-6.2-terra',
        default_reasoning_level: 'high',
        supported_reasoning_levels: [{ effort: 'high' }],
      },
    ],
  })
  expect((await f.load()).models[1]).toMatchObject({ reasoning: [] })
  f.metadata({
    models: [
      {
        slug: 'gpt-6.1-terra',
        default_reasoning_level: 'high',
        supported_reasoning_levels: [{ effort: 'low' }],
      },
    ],
  })
  expect((await f.load()).models[1]).toMatchObject({ reasoning: [{ id: 'low', name: 'low' }] })
  expect((await f.load()).models[1]?.defaultReasoning).toBeUndefined()
})

it.each([503, 200])(
  'keeps discovered IDs when upstream metadata fails with HTTP %s or invalid data',
  async (status) => {
    const f = await fixture()
    f.metadata({ models: [{ slug: 'gpt-6.1-terra' }] }, status)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await f.load()).models[1]).toMatchObject({ id: 'gpt-6.1-terra', reasoning: [] })
    expect(warning).toHaveBeenCalledWith(
      'Could not refresh Codex reasoning metadata; keeping discovered provider models.',
    )
  },
)

it('skips public metadata when the proxy has no additional models', async () => {
  const f = await fixture()
  f.reply(200, { data: [{ id: original.id }] })
  expect((await f.load()).models).toHaveLength(1)
  expect(f.metadataRequests).toHaveLength(0)
})

it.each(['apikey', 'chatgpt'] as const)('uses the configured CODEX_HOME %s login', async (mode) => {
  const f = await fixture()
  delete f.provider.env_key
  f.provider.requires_openai_auth = true
  await mkdir(f.env.CODEX_HOME!, { recursive: true })
  await writeFile(
    join(f.env.CODEX_HOME!, 'auth.json'),
    JSON.stringify({
      auth_mode: mode,
      OPENAI_API_KEY: 'fixture-api-key',
      tokens: { access_token: 'fixture-access-token' },
    }),
  )
  const catalog = await f.load()
  expect(catalog.models.some((m) => m.id === 'gpt-6.1-terra')).toBe(true)
  expect(f.requests[0]?.authorization).toBe(
    `Bearer fixture-${mode === 'apikey' ? 'api-key' : 'access-token'}`,
  )
})

it('honors configured headers, environment headers and query parameters', async () => {
  const f = await fixture()
  delete f.provider.env_key
  f.provider.requires_openai_auth = true
  f.provider.http_headers = { Authorization: 'Bearer static-header', 'X-Profile': 'old' }
  f.provider.env_http_headers = { 'X-Profile': 'FIXTURE_PROFILE' }
  f.provider.query_params = { 'api-version': 'fixture' }
  f.env.FIXTURE_PROFILE = 'selected-profile'
  expect((await f.load()).models).toHaveLength(2)
  expect(f.requests).toEqual([
    {
      url: '/v1/models?api-version=fixture',
      authorization: 'Bearer static-header',
      profile: 'selected-profile',
    },
  ])
})

it('uses the configured static bearer token without reading another account', async () => {
  const f = await fixture()
  delete f.provider.env_key
  f.provider.experimental_bearer_token = 'fixture-static-key'
  f.provider.requires_openai_auth = true
  expect((await f.load()).models).toHaveLength(2)
  expect(f.requests[0]?.authorization).toBe('Bearer fixture-static-key')
})

it.each(['default', 'explicit-file', 'explicit-url', 'older-app-server'])(
  'preserves %s catalog authority',
  async (mode) => {
    const f = await fixture()
    if (mode === 'default') delete f.config.model_providers
    if (mode === 'explicit-file') f.config.model_catalog_json = '/configured/catalog.json'
    if (mode === 'explicit-url') f.provider.model_catalog_url = f.provider.base_url
    if (mode === 'older-app-server') f.env.FIXTURE_OLD_CODEX = '1'
    expect((await f.load()).models).toHaveLength(1)
    expect(f.requests).toHaveLength(0)
    expect(f.metadataRequests).toHaveLength(0)
  },
)

it.each([401, 302, 200])(
  'retains native models on HTTP %s errors or invalid data without leaking credentials',
  async (status) => {
    const f = await fixture()
    f.reply(status, { data: [{ id: null, secret: 'fixture-key' }] })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await f.load()).models).toHaveLength(1)
    expect(f.requests).toHaveLength(1)
    expect(warning).toHaveBeenCalledWith(
      'Could not refresh configured Codex provider models; using the app-server catalog.',
    )
  },
)

it('does not probe a provider with missing configured credentials', async () => {
  const f = await fixture()
  delete f.env.FIXTURE_PROVIDER_KEY
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect((await f.load()).models).toHaveLength(1)
  expect(f.requests).toHaveLength(0)
  expect(warning).toHaveBeenCalledOnce()
})
