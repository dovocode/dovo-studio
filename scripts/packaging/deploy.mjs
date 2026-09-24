import { execFileSync } from 'node:child_process'
export function deploy(args, cwd) {
  // pnpm run exposes the real CLI entrypoint, avoiding cmd.exe quoting on Windows.
  const cli = process.env.npm_execpath
  if (process.platform === 'win32') {
    if (!cli || /\.(cmd|bat)$/i.test(cli))
      throw new Error('On Windows run: pnpm run package:desktop:artifacts')
    const javascript = /\.[cm]?js$/i.test(cli)
    execFileSync(javascript ? process.execPath : cli, javascript ? [cli, ...args] : args, {
      cwd,
      stdio: 'inherit',
    })
  } else execFileSync('pnpm', args, { cwd, stdio: 'inherit' })
}
