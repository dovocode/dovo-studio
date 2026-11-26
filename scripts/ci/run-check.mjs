import { spawn } from 'node:child_process'

export function runCheck(command, args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32' && command === 'pnpm',
    })
    child.once('error', (error) => {
      console.error(`Could not start ${command}: ${error.message}`)
      resolve(1)
    })
    child.once('close', (code, signal) => {
      if (signal) console.error(`${command} ${args.join(' ')} stopped by ${signal}`)
      resolve(code ?? 1)
    })
  })
}
