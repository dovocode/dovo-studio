import { expect, it } from 'vite-plus/test'
import { repairServiceDefinition, serviceDefinition } from './server-service'

it('registers a launchd user service with a private environment file and persistent restart', () => {
  const definition = serviceDefinition(
    'darwin',
    'dovo-server-test',
    '/Users/test/Server & Data',
    [
      '/Users/test/Server & Data/service-launcher',
      'service',
      'run',
      '--data-dir',
      '/Users/test/Server & Data',
    ],
    '/Users/test/Server & Data/runtime-environment.json',
  )
  expect(definition).toContain('<key>RunAtLoad</key><true/>')
  expect(definition).toContain('<key>KeepAlive</key><true/>')
  expect(definition).toContain('Server &amp; Data')
  expect(definition).toContain('DOVO_RUNTIME_ENV_FILE')
  expect(definition).not.toContain('ANTHROPIC_API_KEY')
})

it('registers a restartable systemd user service with escaped paths', () => {
  const definition = serviceDefinition(
    'linux',
    'dovo-server-test',
    '/home/test/Server % Data',
    ['/home/test/Server % Data/service-launcher', 'service', 'run'],
    '/home/test/Server % Data/runtime-environment.json',
  )
  expect(definition).toContain(
    'ExecStart="/home/test/Server %% Data/service-launcher" "service" "run"',
  )
  expect(definition).toContain('Restart=on-failure')
  expect(definition).toContain('WantedBy=default.target')
  expect(definition).not.toContain('ANTHROPIC_API_KEY')
})

it('uses an unquoted working directory, preserving spaces and escaping specifiers', () => {
  const definition = serviceDefinition(
    'linux',
    'test',
    '/home/test/Server % Data',
    ['/bin/true'],
    '/tmp/env',
  )
  expect(definition).toContain('WorkingDirectory=/home/test/Server %% Data\n')
})

it('repairs legacy quoted working directories without replacing other unit settings', () => {
  const legacy = '[Service]\nWorkingDirectory="/home/dominic/.dovo"\nRestartSec=10\n'
  const repaired = repairServiceDefinition(legacy, '/home/dominic/.dovo')
  expect(repaired).toBe('[Service]\nWorkingDirectory=/home/dominic/.dovo\nRestartSec=10\n')
  expect(repairServiceDefinition(repaired, '/home/dominic/.dovo')).toBe(repaired)
  expect(
    repairServiceDefinition('[Service]\nWorkingDirectory=/custom\n', '/home/dominic/.dovo'),
  ).toBe('[Service]\nWorkingDirectory=/custom\n')
})
