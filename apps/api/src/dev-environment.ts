import { homedir } from 'node:os'
import { join } from 'node:path'

export function configureDevelopmentEnvironment(
  environment: NodeJS.ProcessEnv,
  home = homedir(),
): void {
  // A terminal launched inside packaged Dovo can inherit its supervisor configuration.
  if (environment.DOVO_RUNTIME_ENV_FILE) delete environment.DOVO_OWNER_TOKEN
  delete environment.DOVO_RUNTIME_ENV_FILE
  delete environment.DOVO_DESKTOP_DUAL_LISTENER
  delete environment.DOVO_RELEASE_DISTRIBUTION
  delete environment.DOVO_RELEASE_VERSION
  const productionRoot = join(home, '.dovo')
  if (environment.DOVO_DATA_ROOT === productionRoot) delete environment.DOVO_DATA_ROOT
  if (
    environment.DOVO_DATABASE_PATH === join(productionRoot, 'runtime.sqlite') ||
    environment.DOVO_DATABASE_PATH === join(productionRoot, 'desktop', 'runtime.sqlite')
  )
    delete environment.DOVO_DATABASE_PATH
  if (environment.DOVO_SETTINGS_PATH === join(home, '.dovo', 'settings.json'))
    delete environment.DOVO_SETTINGS_PATH
  if (!environment.PORT || environment.PORT === '8787') environment.PORT = '8789'
  environment.DOVO_DATA_ROOT ??= join(home, '.dovo-dev')
  environment.DOVO_DATABASE_PATH ??= join(environment.DOVO_DATA_ROOT, 'runtime.sqlite')
  environment.DOVO_SETTINGS_PATH ??= join(environment.DOVO_DATA_ROOT, 'settings.json')
}
