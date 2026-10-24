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
    const inspection = result.projects[0].inspection
    if (!inspection.available) throw new Error(inspection.error)
    expect(inspection.truncated).toBe(true)
    const evidence = inspection.evidence
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

it('discovers nested ownership and dependency evidence without reading source, scripts or linked folders', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dovo-scope-workspaces-')))
  try {
    await mkdir(join(root, 'apps/dashboard/src'), { recursive: true })
    await mkdir(join(root, 'packages/billing/src'), { recursive: true })
    await mkdir(join(root, 'node_modules/private'), { recursive: true })
    await writeFile(join(root, 'README.md'), 'A dashboard and its shared billing contracts.')
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n  - packages/*\n')
    await writeFile(
      join(root, 'apps/dashboard/package.json'),
      JSON.stringify({
        name: '@example/dashboard',
        description: 'Customer billing screens',
        dependencies: { '@example/billing': 'workspace:*', react: 'latest' },
        scripts: { deploy: 'PRIVATE_SCRIPT_CONTENT' },
      }),
    )
    await writeFile(
      join(root, 'packages/billing/package.json'),
      '{"name":"@example/billing","description":"Shared billing contracts"}',
    )
    await writeFile(join(root, 'apps/dashboard/src/payments.tsx'), 'PRIVATE_SOURCE_CONTENT')
    await writeFile(join(root, 'packages/billing/src/contracts.ts'), 'PRIVATE_CONTRACT_CONTENT')
    await writeFile(join(root, 'node_modules/private/README.md'), 'PRIVATE_DEPENDENCY_CONTENT')
    await symlink(join(root, 'node_modules/private'), join(root, 'linked-package'))
    const result = await projectScopeContext(
      [{ id: 'app', name: 'Application', path: root, branch: 'main' }],
      new AbortController().signal,
      'Update dashboard payments and shared billing contracts',
    )
    const inspection = result.projects[0]!.inspection
    if (!inspection.available) throw new Error(inspection.error)
    const evidence = inspection.evidence
    expect(evidence).toContain('apps/dashboard/src/payments.tsx')
    expect(evidence).toContain('packages/billing/src/contracts.ts')
    expect(evidence).toContain('Customer billing screens')
    expect(evidence).toContain('"dependencies":["@example/billing","react"]')
    expect(evidence).toContain('Shared billing contracts')
    expect(evidence).toContain('pnpm-workspace.yaml (excerpt)')
    expect(evidence).not.toMatch(/PRIVATE_|linked-package/)
    expect(result.directories).toEqual([{ id: 'app', path: root, access: 'read-only' }])
    expect(await readFile(join(root, 'apps/dashboard/src/payments.tsx'), 'utf8')).toBe(
      'PRIVATE_SOURCE_CONTENT',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('prioritizes request-relevant components and marks partial discovery within a large workspace', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dovo-scope-bounded-')))
  try {
    await mkdir(join(root, 'packages'))
    for (const name of [...Array.from({ length: 80 }, (_, i) => `component-${i}`), 'payments']) {
      await mkdir(join(root, 'packages', name))
      await writeFile(
        join(root, 'packages', name, 'package.json'),
        JSON.stringify({ name, description: `Owner of ${name}` }),
      )
    }
    const result = await projectScopeContext(
      [{ id: 'app', name: 'Workspace', path: root, branch: 'main' }],
      new AbortController().signal,
      'Fix payments',
    )
    const inspection = result.projects[0]!.inspection
    if (!inspection.available) throw new Error(inspection.error)
    expect(inspection.evidence).toContain('Owner of payments')
    expect(inspection.evidence.length).toBeLessThanOrEqual(8000)
    expect(inspection.truncated).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
