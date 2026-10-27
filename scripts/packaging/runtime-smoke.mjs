// Exercise native SQLite and a responsive PTY from the packaged dependency tree.
export const runtimeSmoke = `
import { startRuntime } from '@dovo/runtime';
// Electron loads this helper from the same deployed tree. Exercise its native image closure too.
import { createBrowserFaviconLoader } from '@dovo/runtime/browser-favicon';
let favicon;
const loader = createBrowserFaviconLoader(
  () => { throw new Error('The inline packaging icon must not access the network'); },
  value => { favicon = value; },
);
await loader.load('https://packaging.invalid/', [
  'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>'),
]);
if (!favicon?.startsWith('data:image/png;base64,')) throw new Error('Packaged favicon decoder failed');
loader.reset();
const runtime = await startRuntime({
  databasePath: ':memory:', ownerToken: 'packaging-smoke-token-at-least-32-characters', port: 0,
});
try {
  // Multi-file artifacts bundle locally through the packaged esbuild executable.
  const { compileArtifactBundle } = await import(new URL('./artifacts/artifact-bundle.js', import.meta.resolve('@dovo/runtime')));
  const preview = await compileArtifactBundle([
    { path: 'index.html', content: '<script type="module" src="main.js"></script>' },
    { path: 'main.js', content: 'import {label} from "./label.js"; document.body.textContent=label;' },
    { path: 'label.js', content: 'export const label="Packaged folder ready";' },
  ], 'index.html');
  if (!preview.includes('Packaged folder ready')) throw new Error('Packaged artifact compiler failed');
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
