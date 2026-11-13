import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { expect, it } from 'vite-plus/test'
import { MemoryProtection } from './memory-protection.js'
import { readProcessMemory } from './process-memory.js'
import { stopOwnedChild } from './stop-owned-child.js'

it.skipIf(process.platform !== 'linux' && process.platform !== 'darwin')(
  'stops a real bounded launcher and its child using simulated dangerous readings',
  async () => {
    const launcher = spawn(
      process.execPath,
      [
        '-e',
        `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      process.on('SIGTERM', () => {
        child.once('exit', () => process.exit(0));
        child.kill('SIGTERM');
      });
      child.once('spawn', () => process.stdout.write(String(child.pid)));
      setInterval(() => {}, 1000);
    `,
      ],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let at = 0
    let active = true
    let stopped = false
    const guard = new MemoryProtection(
      async () => {
        const real = await readProcessMemory()
        return {
          ...real,
          total: 8 * 1024 ** 3,
          available: 128 * 1024 ** 2,
          pressure: true,
          processes: real.processes.map((row) =>
            row.pid === launcher.pid ? { ...row, rss: 5 * 1024 ** 3 } : row,
          ),
        }
      },
      async () => {},
      () => at,
    )
    try {
      const [data] = await once(launcher.stdout, 'data')
      const descendantPid = Number(String(data))
      expect(descendantPid).toBeGreaterThan(0)
      const real = await readProcessMemory()
      expect(real.processes.find((row) => row.pid === descendantPid)?.group).toBe(launcher.pid)
      guard.begin({
        taskId: 'bounded-task',
        runId: 'bounded-run',
        current: () => active,
        stop: () => {
          stopped = true
          active = false
        },
      })(launcher)
      for (at of [0, 5000, 10000, 15000]) await guard.sample()
      expect(stopped).toBe(true)
      expect(launcher.exitCode !== null || launcher.signalCode !== null).toBe(true)
      expect(() => process.kill(-launcher.pid!, 0)).toThrow(/ESRCH/)
      expect(() => process.kill(descendantPid, 0)).toThrow(/ESRCH/)
      expect(guard.report().lastStop?.taskId).toBe('bounded-task')
    } finally {
      await guard.dispose()
      await stopOwnedChild(launcher)
    }
  },
)
