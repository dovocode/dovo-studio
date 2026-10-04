import { createRequire } from 'node:module'
import { expect, it, vi } from 'vitest'
import { exec } from '../process.js'
import { runtimeIntegration } from '../testing/integration.js'

vi.setConfig(runtimeIntegration)
const ptyPath = createRequire(new URL('../../package.json', import.meta.url)).resolve('node-pty')

for (const natural of [false, true])
  it.runIf(process.platform === 'win32')(
    `releases the ConPTY worker after ${natural ? 'natural' : 'forced'} exit without process.exit`,
    async () => {
      const { stdout } = await exec(
        process.execPath,
        [
          '-e',
          `const pty = require(${JSON.stringify(ptyPath)});
           const terminal = pty.spawn(process.execPath, ['-e', ${JSON.stringify(
             natural ? "console.log('ready')" : "console.log('ready'); setInterval(() => {}, 1000)",
           )}], { useConptyDll: true });
           let output = '';
           let stopped = false;
           terminal.onData(data => {
             output += data;
             if (!${natural} && !stopped && output.includes('ready')) {
               stopped = true;
               terminal.kill();
             }
           });
           terminal.onExit(() => console.log('terminal-exited'));`,
        ],
        { timeout: 10000 },
      )
      expect(stdout).toContain('terminal-exited')
    },
  )
