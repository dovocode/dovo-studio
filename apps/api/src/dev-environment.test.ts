import { expect, it } from 'vite-plus/test'
import { join } from 'node:path'
import { configureDevelopmentEnvironment } from './dev-environment'

it('keeps development runtime data and settings outside production', () => {
  const environment: NodeJS.ProcessEnv = {}
  configureDevelopmentEnvironment(environment, '/home/test')
  expect(environment).toEqual({
    PORT: '8789',
    DOVO_DATA_ROOT: join('/home/test', '.dovo-dev'),
    DOVO_DATABASE_PATH: join('/home/test', '.dovo-dev', 'runtime.sqlite'),
    DOVO_SETTINGS_PATH: join('/home/test', '.dovo-dev', 'settings.json'),
  })
})

it('preserves explicitly configured development paths', () => {
  const environment = {
    PORT: '9000',
    DOVO_DATA_ROOT: '/custom',
    DOVO_DATABASE_PATH: '/db',
    DOVO_SETTINGS_PATH: '/settings',
  }
  configureDevelopmentEnvironment(environment)
  expect(environment).toEqual({
    PORT: '9000',
    DOVO_DATA_ROOT: '/custom',
    DOVO_DATABASE_PATH: '/db',
    DOVO_SETTINGS_PATH: '/settings',
  })
})

it('does not inherit the production supervisor settings or port', () => {
  const environment: NodeJS.ProcessEnv = {
    PORT: '8787',
    DOVO_DATABASE_PATH: '/home/test/.dovo/desktop/runtime.sqlite',
    DOVO_OWNER_TOKEN: 'inherited-production-credential',
    DOVO_DESKTOP_DUAL_LISTENER: '1',
    DOVO_RUNTIME_ENV_FILE: '/home/test/.dovo/desktop/runtime-environment.json',
    DOVO_SETTINGS_PATH: '/home/test/.dovo/settings.json',
  }
  configureDevelopmentEnvironment(environment, '/home/test')
  expect(environment.DOVO_RUNTIME_ENV_FILE).toBeUndefined()
  expect(environment.DOVO_OWNER_TOKEN).toBeUndefined()
  expect(environment.DOVO_DESKTOP_DUAL_LISTENER).toBeUndefined()
  expect(environment.DOVO_DATABASE_PATH).toBe(join('/home/test', '.dovo-dev', 'runtime.sqlite'))
  expect(environment.PORT).toBe('8789')
  expect(environment.DOVO_SETTINGS_PATH).toBe(join('/home/test', '.dovo-dev', 'settings.json'))
})
