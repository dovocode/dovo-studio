import { expect, it } from 'vite-plus/test'
import { serviceDefinition } from './server-service'

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
