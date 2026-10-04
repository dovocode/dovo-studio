import { accessSync, constants, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, isAbsolute, join } from 'node:path'
import type { AgentDiscovery } from '@dovo/protocol'
import { processEnvironment } from '../../../process.js'

function missingExecutable(error: unknown) {
  return (
    error instanceof Error &&
    'code' in error &&
    ['ENOENT', 'ENOTDIR', 'EACCES'].includes(String(error.code))
  )
}
function pythonExecutable(command: string) {
  return /^(?:python(?:\d+(?:\.\d+)*)?|pythonw)(?:\.exe)?$/i.test(basename(command))
}

/** Services may not inherit the installer's ~/.local/bin PATH entry. */
export function hermesExecutable(command: string, environment = processEnvironment()) {
  if (command !== 'hermes') return command
  const name = process.platform === 'win32' ? 'hermes.exe' : 'hermes'
  const directories = [
    ...(environment.PATH ?? '').split(delimiter).filter(Boolean),
    join(environment.HOME || homedir(), '.local', 'bin'),
  ]
  for (const directory of directories) {
    const path = join(directory, name)
    try {
      accessSync(path, constants.X_OK)
      if (statSync(path).isFile()) return path
    } catch (error) {
      if (!missingExecutable(error)) throw error
    }
  }
  return command
}

/** Recognize the published pre-bootstrap installer shim and Python console script.
 * Read only small scripts; never execute or interpret shell expressions.
 */
function legacyPython(command: string) {
  if (!isAbsolute(command)) return undefined
  try {
    const info = statSync(command)
    if (!info.isFile() || info.size > 64 * 1024) return undefined
    const script = readFileSync(command, 'utf8')
    const wrapper = script.match(/^exec "([^"\r\n$`]+)" "([^"\r\n$`]+)" "\$@"\s*$/m)
    const interpreter = wrapper?.[1]
    if (
      interpreter &&
      isAbsolute(interpreter) &&
      pythonExecutable(interpreter) &&
      basename(wrapper[2] ?? '') === 'hermes'
    )
      return interpreter
    const shebang = script.match(/^#!([^\r\n]+)\r?\n/)?.[1]
    if (
      shebang &&
      isAbsolute(shebang) &&
      pythonExecutable(shebang) &&
      script.includes('from hermes_cli.main import main')
    )
      return shebang
  } catch (error) {
    if (!missingExecutable(error)) throw error
  }
  return undefined
}

export function hermesLaunch(agent: AgentDiscovery) {
  const environment = processEnvironment(agent.env)
  const executable = hermesExecutable(
    agent.endpoint || environment.HERMES_PYTHON || 'hermes',
    environment,
  )
  // Explicit args describe the caller's own launch contract and must stay untouched.
  const interpreter = agent.args?.length ? undefined : legacyPython(executable)
  const command = interpreter ?? executable
  const python =
    Boolean(interpreter) || pythonExecutable(command) || command === environment.HERMES_PYTHON
  return {
    command,
    args: agent.args?.length
      ? agent.args
      : python
        ? ['-u', '-P', '-m', 'tui_gateway.entry']
        : ['--run-module', 'tui_gateway.entry'],
    env: {
      ...agent.env,
      ...(agent.env?.HERMES_PYTHON_SRC_ROOT
        ? { PYTHONPATH: agent.env.HERMES_PYTHON_SRC_ROOT }
        : {}),
      PYTHONUNBUFFERED: '1',
    },
  }
}
