import type { ChildProcess } from 'node:child_process'
// Providers receive a graceful shutdown first, but cannot hold cancellation open indefinitely.
export function stopChild(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const deadline = setTimeout(() => child.kill('SIGKILL'), 1000)
  deadline.unref()
  child.once('exit', () => clearTimeout(deadline))
}
