import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registryEntry, searchRegistry } from './registry'
import {
  installCatalogSkill,
  searchSkills,
  previewSkillPackage,
  installSkillPackage,
} from './skills'
import { catalogJson } from './fetch'
import { mcpServerEnvironment, mcpHeaders } from '../configuration/mcp-settings'
const roots: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
const base = { name: 'io.example/docs', description: 'Docs server', version: '1.2.3' }
it('maps pinned packages, required arguments, optional values and environment references', () => {
  const entry = registryEntry({
    ...base,
    packages: [
      {
        registryType: 'npm',
        identifier: '@example/docs',
        version: '2.0.0',
        transport: { type: 'stdio' },
        packageArguments: [
          { type: 'positional', valueHint: 'directory', isRequired: true },
          { type: 'named', name: '--verbose', value: 'true' },
        ],
        environmentVariables: [
          { name: 'TOKEN', isSecret: true, isRequired: true },
          { name: 'MODE', value: 'docs' },
          { name: 'OPTIONAL' },
        ],
      },
    ],
  })
  const server = entry.variants[0].server!
  expect(server.command).toBe('npx')
  expect(server.args).toEqual([
    '-y',
    '@example/docs@2.0.0',
    '__CONFIGURE_directory__',
    '--verbose',
    'true',
  ])
  expect(server.env).toEqual({ TOKEN: 'TOKEN' })
  expect(server.envValues).toEqual({ MODE: 'docs' })
  expect(server.sourceRevision).toBe('1.2.3')
  vi.stubEnv('TOKEN', 'example-token')
  expect(mcpServerEnvironment(server)).toEqual({ MODE: 'docs', TOKEN: 'example-token' })
})
it('imports HTTP header bindings and keeps unsupported transports visible', () => {
  const entry = registryEntry({
    ...base,
    remotes: [
      { type: 'sse', url: 'https://example.com/sse' },
      {
        type: 'streamable-http',
        url: 'https://example.com/{workspace}/mcp',
        headers: [
          { name: 'Authorization', value: 'Bearer {token}', isSecret: true, isRequired: true },
          { name: 'X-Version', value: '2' },
        ],
      },
    ],
  })
  expect(entry.variants[0].server).toBeUndefined()
  const server = entry.variants[1].server!
  expect(server.url).toContain('__CONFIGURE_workspace__')
  expect(server.bearerTokenEnv).toBe('MCP_BEARER_TOKEN')
  vi.stubEnv('MCP_BEARER_TOKEN', 'example-token')
  expect(mcpHeaders(server)).toEqual({ Authorization: 'Bearer example-token', 'X-Version': '2' })
})
it('does not silently install packages whose integrity requirements cannot be verified', () => {
  const result = registryEntry({
    ...base,
    packages: [
      {
        registryType: 'npm',
        identifier: 'docs',
        fileSha256: 'a'.repeat(64),
        transport: { type: 'stdio' },
      },
    ],
  })
  expect(result.variants[0].server).toBeUndefined()
  expect(result.variants[0].notes.join(' ')).toContain('integrity')
})
it('searches latest active registry entries with cursor pagination and validates skills results', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({
        servers: [
          {
            server: base,
            _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } },
          },
          {
            server: { ...base, name: 'deleted' },
            _meta: { 'io.modelcontextprotocol.registry/official': { status: 'deleted' } },
          },
        ],
        metadata: { nextCursor: 'next' },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        skills: [
          {
            id: 'owner/repo/review',
            skillId: 'review',
            name: 'Review',
            source: 'owner/repo',
            installs: 12,
          },
          { id: 'example.com/skill', name: 'Web skill', source: 'example.com', installs: 1 },
        ],
      }),
    )
  vi.stubGlobal('fetch', fetch)
  expect(await searchRegistry({ query: 'docs', cursor: 'prior' })).toMatchObject({
    entries: [{ name: base.name }],
    cursor: 'next',
  })
  expect(fetch.mock.calls[0][0]).toContain('version=latest')
  expect(fetch.mock.calls[0][0]).toContain('cursor=prior')
  expect((await searchSkills({ query: 'review' })).entries.map((entry) => entry.supported)).toEqual(
    [true, false],
  )
})
it('imports supporting files from one pinned revision and rejects symlink bundles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo-catalog-test-'))
  roots.push(root)
  const sha = 'a'.repeat(40)
  let symlink = false
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : input.toString()
      requests.push(url)
      if (url.endsWith('/commits/HEAD')) return Response.json({ sha })
      if (url.includes('/git/trees/'))
        return Response.json({
          truncated: false,
          tree: [
            { path: 'skills/review/SKILL.md', type: 'blob', mode: '100644', size: 80 },
            {
              path: 'skills/review/scripts/check.sh',
              type: 'blob',
              mode: symlink ? '120000' : '100755',
              size: 10,
            },
          ],
        })
      if (url.endsWith('/SKILL.md'))
        return new Response(
          '---\nname: review\ndescription: Review code\n---\nRun scripts/check.sh',
        )
      return new Response('echo check')
    }),
  )
  const skill = await installCatalogSkill({ source: 'owner/repo', skill: 'review' }, root)
  expect(skill.sourceRevision).toBe(sha)
  expect(await readFile(join(skill.sourcePath!, '..', 'scripts/check.sh'), 'utf8')).toBe(
    'echo check',
  )
  expect(
    requests
      .filter((url) => url.includes('raw.githubusercontent.com'))
      .every((url) => url.includes(sha)),
  ).toBe(true)
  expect(
    (await installCatalogSkill({ source: 'owner/repo', skill: 'review' }, root)).sourcePath,
  ).toBe(skill.sourcePath)
  symlink = true
  await expect(
    installCatalogSkill({ source: 'owner/repo', skill: 'review' }, root),
  ).rejects.toThrow('symlinks')
  expect((await readdir(root)).filter((name) => name.startsWith('.import-'))).toEqual([])
})
it('surfaces catalog outages and rejects oversized payloads', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('12345')),
  )
  await expect(catalogJson('https://skills.sh/api/search')).rejects.toThrow('rate limit')
  await expect(catalogJson('https://skills.sh/api/search', 2)).rejects.toThrow('too large')
})
it('finds catalog skills by their declared name when folder names differ, and keeps supporting files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo-catalog-name-'))
  roots.push(root)
  const sha = 'b'.repeat(40)
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : input.toString()
      requests.push(url)
      if (url.includes('/commits/')) return Response.json({ sha })
      if (url.includes('/git/trees/'))
        return Response.json({
          truncated: false,
          tree: [
            { path: 'SKILL.md', type: 'blob', mode: '100644', size: 80 },
            { path: 'skills/broken/SKILL.md', type: 'blob', mode: '100644', size: 80 },
            {
              path: 'skills/react-best-practices/SKILL.md',
              type: 'blob',
              mode: '100644',
              size: 80,
            },
            {
              path: 'skills/react-best-practices/rules/render.md',
              type: 'blob',
              mode: '100644',
              size: 80,
            },
          ],
        })
      if (url.includes('/broken/')) return new Response('Invalid frontmatter')
      if (url.endsWith('/rules/render.md')) return new Response('Supporting rule')
      const name = url.includes('/react-best-practices/')
        ? 'vercel-react-best-practices'
        : 'repository-overview'
      return new Response(
        `---\nname: ${name}\ndescription: Review React\n---\nRead rules/render.md`,
      )
    }),
  )
  const skill = await installCatalogSkill(
    { source: 'vercel-labs/agent-skills', skill: 'vercel-react-best-practices' },
    root,
  )
  expect(skill.name).toBe('vercel-react-best-practices')
  expect(skill.sourceRevision).toBe(sha)
  expect(skill.sourceUrl).toBe(
    'https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices',
  )
  expect(await readFile(join(skill.sourcePath!, '..', 'rules/render.md'), 'utf8')).toBe(
    'Supporting rule',
  )
  expect(requests.filter((url) => url.endsWith('/react-best-practices/SKILL.md'))).toHaveLength(1)
})
it.each(['skills', '.agents/skills'])(
  'rejects ambiguous declared skill names in %s',
  async (directory) => {
    const root = await mkdtemp(join(tmpdir(), 'dovo-catalog-ambiguous-'))
    roots.push(root)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = input instanceof Request ? input.url : input.toString()
        if (url.includes('/commits/')) return Response.json({ sha: 'a'.repeat(40) })
        if (url.includes('/git/trees/'))
          return Response.json({
            truncated: false,
            tree: ['first', 'second'].map((name) => ({
              path: `${directory}/${name}/SKILL.md`,
              type: 'blob',
              mode: '100644',
              size: 80,
            })),
          })
        return new Response('---\nname: review\ndescription: Review\n---\nReview code')
      }),
    )
    await expect(
      installCatalogSkill({ source: 'owner/repo', skill: 'review' }, root),
    ).rejects.toThrow('one SKILL.md')
    expect(await readdir(root)).toEqual([])
  },
)

it.each([false, true])(
  'selects the portable skill bundle among agent-specific copies (reverse: %s)',
  async (reverse) => {
    const root = await mkdtemp(join(tmpdir(), 'dovo-catalog-portable-'))
    roots.push(root)
    const sha = 'c'.repeat(40)
    const paths = [
      '.claude/skills/impeccable/SKILL.md',
      'plugin/skills/impeccable/SKILL.md',
      'tests/fixture/.agents/skills/impeccable/SKILL.md',
      '.agents/skills/impeccable/SKILL.md',
      '.agents/skills/impeccable/references/design.md',
    ]
    if (reverse) paths.reverse()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = input instanceof Request ? input.url : input.toString()
        if (url.includes('/commits/')) return Response.json({ sha })
        if (url.includes('/git/trees/'))
          return Response.json({
            truncated: false,
            tree: paths.map((path) => ({ path, type: 'blob', mode: '100644', size: 120 })),
          })
        if (url.endsWith('/references/design.md')) return new Response('Portable supporting file')
        const portable = url.endsWith('/' + sha + '/.agents/skills/impeccable/SKILL.md')
        return new Response(
          '---\nname: impeccable\ndescription: Design UI\n---\n' +
            (portable ? 'Read references/design.md' : 'Agent-specific instructions'),
        )
      }),
    )
    const skill = await installCatalogSkill(
      { source: 'pbakaus/impeccable', skill: 'impeccable' },
      root,
    )
    expect(skill.content).toBe('Read references/design.md')
    expect(skill.sourceRevision).toBe(sha)
    expect(skill.sourceUrl).toBe('https://skills.sh/pbakaus/impeccable/impeccable')
    expect(await readFile(join(skill.sourcePath!, '..', 'references/design.md'), 'utf8')).toBe(
      'Portable supporting file',
    )
    expect(await readdir(join(skill.sourcePath!, '..'))).toEqual(['SKILL.md', 'references'])
  },
)

it('previews sibling skills, installs a selected package with shared assets and keeps single installs isolated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo-package-test-'))
  roots.push(root)
  const sha = 'd'.repeat(40)
  const files = {
    '.agents/skills/review/SKILL.md':
      '---\nname: review\ndescription: Review code\n---\nRead ../shared/check.sh',
    '.agents/skills/ship/SKILL.md':
      '---\nname: ship\ndescription: Ship code\n---\nRead ../review/SKILL.md',
    '.agents/skills/shared/check.sh': 'echo shared',
    '.claude/skills/review/SKILL.md':
      '---\nname: review\ndescription: Provider copy\n---\nProvider instructions',
    'tests/fixture/SKILL.md': '---\nname: fixture\ndescription: Test fixture\n---\nDo not install',
  }
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : input.toString()
      requests.push(url)
      if (url.includes('/commits/')) return Response.json({ sha })
      if (url.includes('/git/trees/'))
        return Response.json({
          truncated: false,
          tree: Object.entries(files).map(([path, content]) => ({
            path,
            type: 'blob',
            mode: path.endsWith('.sh') ? '100755' : '100644',
            size: content.length,
          })),
        })
      const path = url.split(`/${sha}/`)[1]
      const content = Object.entries(files).find(([key]) => key === path)?.[1]
      return new Response(content, { status: content ? 200 : 404 })
    }),
  )
  const preview = await previewSkillPackage({ source: 'owner/repo', skill: 'review' })
  expect(preview.skills.map((skill) => skill.name)).toEqual(['review', 'ship'])
  const installed = await installSkillPackage(
    {
      source: 'owner/repo',
      skill: 'review',
      revision: preview.revision,
      skills: ['review', 'ship'],
    },
    root,
  )
  expect(installed.skills.map((skill) => skill.sourcePackage)).toEqual([true, true])
  expect(
    await readFile(join(installed.skills[0].sourcePath!, '../../shared/check.sh'), 'utf8'),
  ).toBe('echo shared')
  expect(
    await readFile(join(installed.skills[1].sourcePath!, '../../review/SKILL.md'), 'utf8'),
  ).toContain('Review code')
  const single = await installCatalogSkill({ source: 'owner/repo', skill: 'review' }, root)
  expect(single.sourcePackage).toBeUndefined()
  expect(await readdir(join(single.sourcePath!, '..'))).toEqual(['SKILL.md'])
  const shared = await installCatalogSkill(
    { source: 'owner/repo', skill: 'ship', revision: sha, package: true },
    root,
  )
  expect(shared.sourcePath).toBe(installed.skills[1].sourcePath)
  await expect(
    installSkillPackage(
      { source: 'owner/repo', skill: 'review', revision: sha, skills: ['fixture'] },
      root,
    ),
  ).rejects.toThrow('package preview')
  expect(
    requests
      .filter((url) => url.includes('raw.githubusercontent.com'))
      .every((url) => url.includes(sha)),
  ).toBe(true)
})
