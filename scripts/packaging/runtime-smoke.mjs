// Exercise native SQLite and a responsive PTY from the packaged dependency tree.
export const runtimeSmoke = `
import { startRuntime } from '@dovo/runtime';
const runtime = await startRuntime({
  databasePath: ':memory:', ownerToken: 'packaging-smoke-token-at-least-32-characters', port: 0,
});
try {
  const terminal = runtime.services.terminals.create('packaging-check', process.cwd());
  await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Packaged terminal did not respond')), 15000);
    runtime.services.terminals.attach(terminal.id, (chunk) => {
      output += chunk;
      if (output.includes('\\nDOVO_RUNTIME_READY\\r')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    runtime.services.terminals.input(terminal.id, 'echo DOVO_RUNTIME_' + 'READY\\r');
  });
} finally {
  await runtime.close();
}
`
