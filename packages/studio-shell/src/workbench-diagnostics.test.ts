import { expect, it } from 'vite-plus/test'
import { workbenchDiagnosticContext } from './workbench-diagnostics'

it('uses the local Apple Silicon desktop bridge despite Chromium reporting MacIntel', () => {
  expect(
    workbenchDiagnosticContext(
      {
        version: '0.0.9-nightly.684',
        channel: 'nightly',
        viewer: { platform: 'darwin', architecture: 'arm64', processArchitecture: 'arm64' },
      },
      'MacIntel',
    ),
  ).toEqual({
    appVersion: '0.0.9-nightly.684',
    channel: 'nightly',
    viewerPlatform: 'darwin',
    viewerArchitecture: 'arm64',
    viewerProcessArchitecture: 'arm64',
  })
})

it('keeps the viewer hardware and translated process architectures distinct', () => {
  const context = workbenchDiagnosticContext(
    {
      version: '0.0.9',
      channel: 'stable',
      viewer: { platform: 'darwin', architecture: 'arm64', processArchitecture: 'x64' },
    },
    'MacIntel',
  )
  expect(context.viewerArchitecture).toBe('arm64')
  expect(context.viewerProcessArchitecture).toBe('x64')
})

it('labels the web compatibility string without inferring viewer hardware', () => {
  for (const appInfo of [undefined, { version: '0.0.9', channel: 'dev' } as const]) {
    const context = workbenchDiagnosticContext(appInfo, 'MacIntel')
    expect(context.browserPlatformLegacy).toBe('MacIntel')
    expect(context).not.toHaveProperty('platform')
    expect(context).not.toHaveProperty('viewerPlatform')
    expect(context).not.toHaveProperty('viewerArchitecture')
  }
  expect(workbenchDiagnosticContext(undefined, undefined).viewerArchitecture).toBeUndefined()
})
