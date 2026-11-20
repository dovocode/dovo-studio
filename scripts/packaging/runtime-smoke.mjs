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
  // Load the actual bundled weights, tokenizer and native CPU binding from the deployed tree.
  const { WorkspaceRouter } = await import(new URL('./agents/tasks/workspace-router.js', import.meta.resolve('@dovo/runtime')));
  const router = new WorkspaceRouter();
  try {
    const suggestion = await router.route('https://example.com');
    if (!suggestion.reason.startsWith('GLiClass suggests ')) throw new Error('Packaged workspace router did not run GLiClass: ' + suggestion.reason);
  } finally {
    await router.dispose();
  }
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
  // Remembered Unix terminals run in the separate holder entry from the same deployed tree.
  if (process.platform !== 'win32') {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { TerminalHolder } = await import(new URL('./terminal/holder-client.js', import.meta.resolve('@dovo/runtime')));
    const directory = await mkdtemp(join(tmpdir(), 'dovo-holder-smoke-'));
    try {
      // No service manager: the packaging check must not register a user service.
      delete process.env.DOVO_TERMINAL_HOLDER_SUPERVISOR;
      const holder = new TerminalHolder(join(directory, 'holder'));
      const held = holder.open('00000000-0000-4000-8000-000000000000', {
        file: process.execPath,
        args: ['-e', "console.log('DOVO_HOLDER_READY'); setInterval(() => {}, 1000)"],
        cwd: directory, env: {}, cols: 80, rows: 24,
      });
      await new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => reject(new Error('Packaged terminal holder did not respond: ' + JSON.stringify(output.slice(-2000)))), 15000);
        held.onFailure((error) => { clearTimeout(timeout); reject(error); });
        held.onData((chunk) => {
          output += chunk;
          if (output.includes('DOVO_HOLDER_READY')) { clearTimeout(timeout); resolve(); }
        });
      });
      await held.close();
    } finally {
      // Removing its socket also stops the holder.
      await rm(directory, { recursive: true, force: true });
    }
  }
} finally {
  await runtime.close();
}
`
