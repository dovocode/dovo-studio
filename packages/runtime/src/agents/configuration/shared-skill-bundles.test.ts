import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, readFile, rm, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SharedSkillBundles } from './shared-skill-bundles'
import type { ManagedSkill } from '@dovo/protocol'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
it('materializes a pinned shared bundle on this host, preserves edited instructions and reuses it offline after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dovo-shared-skill-test-'))
  roots.push(root)
  const sha = 'b'.repeat(40),
    requests: string[] = []
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
            { path: 'review/SKILL.md', type: 'blob', mode: '100644', size: 80 },
            { path: 'review/check.sh', type: 'blob', mode: '100755', size: 10 },
          ],
        })
      if (url.endsWith('/SKILL.md'))
        return new Response('---\nname: review\ndescription: Review\n---\nRun check.sh')
      return new Response('echo check')
    }),
  )
  const skill: ManagedSkill = {
    name: 'review',
    enabled: true,
    description: 'Review',
    content: 'Edited instructions: run check.sh',
    sourceUrl: 'https://skills.sh/owner/repo/review',
    sourceRevision: sha,
  }
  const resolver = new SharedSkillBundles(root)
  const [one, two] = await Promise.all([
    resolver.materialize([skill]),
    resolver.materialize([skill]),
  ])
  expect(one).toEqual(two)
  expect(one[0].content).toBe(skill.content)
  expect(one[0].sourcePath).toContain(root)
  expect(requests.filter((url) => url.includes('/commits/'))).toEqual([
    `https://api.github.com/repos/owner/repo/commits/${sha}`,
  ])
  expect(await readFile(join(one[0].sourcePath!, '..', 'check.sh'), 'utf8')).toBe('echo check')
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('offline')
    }),
  )
  expect(await new SharedSkillBundles(root).materialize([skill])).toEqual(one)
  const index = (await readdir(root)).find((file) => file.startsWith('.shared-'))!
  await writeFile(join(root, index), '{broken')
  await expect(new SharedSkillBundles(root).materialize([skill])).rejects.toThrow('offline')
})
