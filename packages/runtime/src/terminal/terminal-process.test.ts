import { createRequire } from 'node:module'
import { expect, it, vi } from 'vite-plus/test'
import { exec } from '../process.js'
import { runtimeIntegration } from '../testing/integration.js'

vi.setConfig(runtimeIntegration)
const ptyPath = createRequire(new URL('../../package.json', import.meta.url)).resolve('node-pty')

it.runIf(process.platform === 'win32')(
  'survives concurrent ConPTY creation and natural and forced exits',
  async () => {
    // Run outside Vitest so a native crash is reported as a failed test, and a retained
    // output worker is caught by the process timeout rather than hidden by process.exit().
    const { stdout } = await exec(
      process.execPath,
      [
        '-e',
        `const pty = require(${JSON.stringify(ptyPath)});
         let exited = 0;
         for (let index = 0; index < 12; index++) {
           const natural = index % 2 === 0;
           const terminal = pty.spawn(process.execPath, ['-e', natural
             ? "console.log('ready')"
             : "console.log('ready'); setInterval(() => {}, 1000)"], { useConptyDll: true });
           let output = '';
           let stopped = false;
           terminal.onData(data => {
             output += data;
             if (!natural && !stopped && output.includes('ready')) {
               stopped = true;
               terminal.kill();
             }
           });
           terminal.onExit(() => {
             if (++exited === 12) console.log('all-terminals-exited');
           });
         }`,
      ],
      { timeout: 15_000 },
    )
    expect(stdout).toContain('all-terminals-exited')
  },
)

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
