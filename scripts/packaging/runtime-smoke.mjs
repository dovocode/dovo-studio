// Exercise native SQLite and a responsive PTY from the packaged dependency tree.
export const runtimeSmoke = `
import { startRuntime } from '@dovo/runtime';
const runtime = await startRuntime({
  databasePath: ':memory:', ownerToken: 'packaging-smoke-token-at-least-32-characters', port: 0,
});
try {
  // The parser entry point and Wasm grammars must ship beside the runtime. Folder
  // fallback would hide a packaging mistake, so require real Swift dependency links.
  const parser = await import(new URL('./scm/reviews/order.js', import.meta.resolve('@dovo/runtime')));
  const groups = await parser.relatedFileGroups([
    { path: 'Sources/App/View.swift', after: 'struct View { let user: User }' },
    { path: 'Sources/App/User.swift', after: 'struct User { let id: Int }' },
  ]);
  if (groups.length !== 1 || groups[0].basis !== 'ast' || groups[0].paths[0] !== 'Sources/App/User.swift')
    throw new Error('Packaged Swift review parser did not resolve dependencies');
  for (const provider of ['codex', 'claude', 'opencode', 'hermes', 'copilot', 'grok', 'muse', 'cursor', 'acp']) await runtime.services.agents.get(provider);
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
