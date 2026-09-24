// Exercise native SQLite and a responsive PTY from the packaged dependency tree.
export const runtimeSmoke = `
import { startRuntime } from '@dovo/runtime';
const runtime = await startRuntime({
  databasePath: ':memory:', ownerToken: 'packaging-smoke-token-at-least-32-characters', port: 0,
});
try {
  const terminal = runtime.services.terminals.createCommand('packaging-check', process.cwd(), {
    command: process.execPath,
    args: ['-e', "console.log('DOVO_RUNTIME_READY'); setInterval(() => {}, 1000)"],
    env: {},
  }, 'Packaging check');
  await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Packaged terminal did not respond: ' + JSON.stringify(output.slice(-2000)))), 15000);
    runtime.services.terminals.attach(terminal.id, (chunk) => {
      output += chunk;
      if (output.includes('DOVO_RUNTIME_READY')) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
} finally {
  await runtime.close();
}
`
