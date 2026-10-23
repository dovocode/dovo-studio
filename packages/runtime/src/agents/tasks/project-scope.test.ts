import { expect, it } from 'vite-plus/test'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { projectScopeContext } from './project-scope'

it('supplies bounded project evidence and read-only roots without following summary symlinks', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dovo-scope-')))
  const readme = 'Dashboard consumes billing-api.\n' + 'x'.repeat(10000)
  try {
    await writeFile(join(root, 'README.md'), readme)
    await writeFile(join(root, 'package.json'), '{"name":"billing-dashboard"}')
    await writeFile(join(root, '.env'), 'PRIVATE_TOKEN=secret')
    await symlink(join(root, '.env'), join(root, 'go.mod'))
    await mkdir(join(root, 'src'))
    await mkdir(join(root, 'node_modules'))
    const result = await projectScopeContext(
      [
        { id: 'web', name: 'Dashboard', path: root, branch: 'main' },
        { id: 'missing', name: 'Offline', path: join(root, 'missing'), branch: '' },
      ],
      new AbortController().signal,
    )
    expect(result.directories).toEqual([{ id: 'web', path: root, access: 'read-only' }])
    expect(result.projects[0].inspection.truncated).toBe(true)
    const evidence = result.projects[0].inspection.evidence
    expect(evidence).toContain('Dashboard consumes billing-api')
    expect(evidence).toContain('billing-dashboard')
    expect(evidence).toContain('src/')
    expect(evidence).not.toContain('node_modules')
    expect(evidence).not.toContain('PRIVATE_TOKEN')
    expect(evidence!.length).toBeLessThanOrEqual(8000)
    expect(result.projects[1].inspection).toEqual({ available: false, error: 'ENOENT' })
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe(readme)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('preserves cancellation instead of classifying aborted projects as unavailable', async () => {
  const controller = new AbortController()
  controller.abort(new Error('Scope cancelled'))
  await expect(
    projectScopeContext(
      [{ id: 'web', name: 'Dashboard', path: '/missing', branch: '' }],
      controller.signal,
    ),
  ).rejects.toThrow('Scope cancelled')
})
