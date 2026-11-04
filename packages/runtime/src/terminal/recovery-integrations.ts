import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Schema } from 'effect'
import { decode } from '@dovo/protocol'
import { quote } from 'shell-quote'

const marker = '// Dovo terminal session recovery v1\n'
const objectSchema = Schema.Record(Schema.String, Schema.Unknown)
function object(value: unknown) {
  return { ...decode(objectSchema, value) }
}
function ownedFile(path: string, source: string) {
  if (existsSync(path) && !readFileSync(path, 'utf8').startsWith(marker))
    throw new Error(`Recovery integration already exists and is not owned by Dovo: ${path}`)
  atomicFile(path, marker + source)
}
function atomicFile(path: string, source: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, source, { mode: 0o600 })
  renameSync(temporary, path)
}
function addHooks(path: string, command: string, events: readonly string[]) {
  const config = existsSync(path) ? object(JSON.parse(readFileSync(path, 'utf8'))) : {}
  const hooks = config.hooks === undefined ? {} : object(config.hooks)
  for (const name of events) {
    const groups =
      hooks[name] === undefined ? [] : decode(Schema.Array(Schema.Unknown), hooks[name])
    // Keep the supported hook schema; identify our entry by its exact command.
    hooks[name] = [
      ...groups.filter((group) => {
        const handlers = object(group).hooks
        return (
          !Array.isArray(handlers) ||
          handlers.length !== 1 ||
          object(handlers[0]).command !== command
        )
      }),
      { hooks: [{ type: 'command', command, timeout: 3 }] },
    ]
  }
  config.hooks = hooks
  atomicFile(path, JSON.stringify(config, null, 2) + '\n')
}

// Plain JavaScript assets are generated into the owning runtime's private data directory.
// They run inside the tools' supported lifecycle APIs, never by parsing terminal screen text.
export const recoveryReporterSource = String.raw`
const fs = require('node:fs');
const path = require('node:path');
exports.report = function(provider, sessionId, directory, ended = false) {
  const root = process.env.DOVO_TERMINAL_RECOVERY_DIRECTORY;
  if (!root || !fs.existsSync(root) || fs.existsSync(path.join(root, 'closing'))) return;
  // A multiplexer owns its children's lifetime. Resume its viewer, never a second agent.
  if (!['tmux', 'herdr'].includes(provider) && (process.env.TMUX || process.env.HC_SCOPE)) return;
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 4000 || /[\x00-\x1f\x7f]/.test(sessionId)) return;
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) return;
  const file = path.join(root, 'state.json');
  if (ended) {
    if (!fs.existsSync(file)) return;
    const current = JSON.parse(fs.readFileSync(file, 'utf8')).target;
    if (!current || current.provider !== provider || current.sessionId !== sessionId) return;
  }
  const target = ended ? null : {provider, sessionId, directory};
  const temporary = file + '.' + process.pid + '.' + require('node:crypto').randomUUID();
  fs.writeFileSync(temporary, JSON.stringify({target}), {mode: 0o600});
  fs.renameSync(temporary, file);
};
// Hook stdout is captured by agent CLIs. Publish to the owning terminal's private
// status file instead of printing escape sequences into hook output.
exports.status = function(provider, sessionId, activity) {
  const root = process.env.DOVO_TERMINAL_STATUS_DIRECTORY || process.env.DOVO_TERMINAL_RECOVERY_DIRECTORY;
  if (!root || !fs.existsSync(root) || fs.existsSync(path.join(root, 'closing'))) return;
  if (process.env.TMUX || process.env.HC_SCOPE) return;
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 4000 || /[\x00-\x1f\x7f]/.test(sessionId)) return;
  const file = path.join(root, 'activity.json');
  if (fs.existsSync(file)) {
    const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (previous.provider !== provider || previous.sessionId !== sessionId) {
      if (!activity || activity.state !== 'idle') return;
    }
  }
  const temporary = file + '.' + process.pid + '.' + require('node:crypto').randomUUID();
  fs.writeFileSync(temporary, JSON.stringify({id: require('node:crypto').randomUUID(), at:Date.now(), provider, sessionId, activity: activity && {...activity, app:provider}}), {mode:0o600});
  fs.renameSync(temporary, file);
};
exports.hook = function(provider, event) {
  if (event.agent_id) return;
  const name = event.hook_event_name;
  if (name === 'SessionStart' || name === 'SessionEnd')
    exports.report(provider, event.session_id, event.cwd, name === 'SessionEnd');
  let activity;
  if (name === 'SessionStart' || name === 'Interrupt') activity = {state:'idle'};
  else if (name === 'SessionEnd') activity = null;
  else if (name === 'Stop') activity = {state:'done'};
  else if (name === 'StopFailure') activity = {state:'error'};
  else if (name === 'PermissionRequest') activity = {state:'blocked',kind:'permission'};
  else if (name === 'PreToolUse' && ['AskUserQuestion','request_user_input'].includes(event.tool_name)) activity = {state:'blocked',kind:'question'};
  else if (['UserPromptSubmit','PreToolUse','PostToolUse','PostToolUseFailure'].includes(name)) activity = {state:'working'};
  else if (name === 'Notification') {
    if (event.notification_type === 'permission_prompt') activity = {state:'blocked',kind:'permission'};
    if (event.notification_type === 'idle_prompt') activity = {state:'idle'};
    if (event.notification_type === 'elicitation_dialog') activity = {state:'blocked',kind:'question'};
  }
  if (activity !== undefined) exports.status(provider, event.session_id, activity);
};
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', data => {
    input += data;
    if (input.length > 65536) { console.error('Dovo recovery hook input exceeded limit'); process.exit(1); }
  });
  process.stdin.on('end', () => {
    const event = JSON.parse(input);
    exports.hook(process.argv[2], event);
  });
}
`

export const recoveryLauncherSource = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const reporter = require('./report.cjs');
delete process.env.ELECTRON_RUN_AS_NODE;
const name = process.argv[2];
let args = process.argv.slice(3);
// macOS exposes /private/var through /var. Node resolves __dirname to its real path;
// compare the executable's real directory too, or an aliased PATH selects this launcher again.
const launcherDirectory = fs.realpathSync(path.join(__dirname, 'bin'));
const directories = (process.env.PATH || '').split(path.delimiter);
const executable = directories.map(dir => path.resolve(dir, name)).find(file => {
  try {
    if (path.dirname(fs.realpathSync(file)) === launcherDirectory) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  }
  catch (error) { if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) return false; throw error; }
});
if (!executable) { console.error(name + ': executable not found outside Dovo integration'); process.exit(127); }
let target;
const cwd = process.cwd();
if (name === 'tmux') {
  if (!args.length) {
    const id = path.basename(process.env.DOVO_TERMINAL_RECOVERY_DIRECTORY || '');
    if (/^[a-f0-9-]{36}$/.test(id)) args = ['new-session', '-A', '-s', 'dovo-' + id];
  }
  const action = args[0];
  if (['new', 'new-session', 'attach', 'attach-session'].includes(action) && !args.includes('-d')) {
    const flag = action.startsWith('new') ? '-s' : '-t';
    const index = args.indexOf(flag);
    if (index >= 0 && args[index + 1]) {
      const selected = args[index + 1];
      const probe = cp.spawnSync(executable, ['display-message', '-p', '-t', selected, '#{session_name}'], {encoding:'utf8', timeout:3000});
      const session = probe.status === 0 ? probe.stdout.trim() : action.startsWith('new') ? selected : undefined;
      if (session) target = {provider:'tmux', sessionId:session, directory:cwd};
    }
  }
} else if (name === 'hc' && args[0] === 'attach' && args[1] && !args[1].startsWith('-')) {
  const probe = cp.spawnSync(executable, ['get', args[1], '--json'], {encoding:'utf8', timeout:3000});
  if (probe.status === 0) {
    const result = JSON.parse(probe.stdout);
    const session = result.address || (result.terminal && result.terminal.address);
    if (typeof session === 'string' && /^(?:[A-Za-z0-9_.-]+\/)?t[0-9a-z]+$/.test(session))
      target = {provider:'herdr', sessionId:session, directory:cwd};
  }
}
if (target) reporter.report(target.provider, target.sessionId, target.directory);
const child = cp.spawn(executable, args, {stdio:'inherit'});
// The foreground group receives terminal signals; keep the launcher until its child exits.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});
child.on('error', error => { console.error(error.message); process.exitCode = 127; });
child.on('exit', (code, signal) => {
  if (target) reporter.report(target.provider, target.sessionId, target.directory, true);
  process.exitCode = code === null ? 1 : code;
});
`

export function installRecoveryIntegrations(
  directory: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const reporter = join(directory, 'report.cjs')
  ownedFile(reporter, recoveryReporterSource)
  ownedFile(join(directory, 'launch.cjs'), recoveryLauncherSource)
  if (process.platform !== 'win32') {
    for (const name of ['tmux', 'hc']) {
      const file = join(directory, 'bin', name)
      const source = `#!/bin/sh\n# Dovo terminal session recovery v1\nELECTRON_RUN_AS_NODE=1 exec ${quote([process.execPath, join(directory, 'launch.cjs'), name])} "$@"\n`
      if (
        existsSync(file) &&
        !readFileSync(file, 'utf8').startsWith('#!/bin/sh\n# Dovo terminal session recovery v1\n')
      )
        throw new Error(`Recovery launcher is not owned by Dovo: ${file}`)
      atomicFile(file, source)
      chmodSync(file, 0o700)
    }
  }
  const command = (provider: string) =>
    process.platform === 'win32'
      ? `set "ELECTRON_RUN_AS_NODE=1" && "${process.execPath}" "${reporter}" ${provider}`
      : `ELECTRON_RUN_AS_NODE=1 ${quote([process.execPath, reporter, provider])}`
  const codex = environment.CODEX_HOME || join(homedir(), '.codex')
  const claude = environment.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const pi = environment.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent')
  const opencode = join(environment.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode')
  addHooks(join(codex, 'hooks.json'), command('codex'), [
    'SessionStart',
    'SessionEnd',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'PermissionRequest',
    'Stop',
    'Interrupt',
  ])
  addHooks(join(claude, 'settings.json'), command('claude'), [
    'SessionStart',
    'SessionEnd',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'PermissionRequest',
    'Notification',
    'Stop',
    'StopFailure',
  ])
  const module = JSON.stringify(pathToFileURL(reporter).href)
  ownedFile(
    join(pi, 'extensions', 'dovo-terminal-recovery.ts'),
    `
import reporter from ${module};
export default function(pi) {
  pi.on('session_start', (_event, ctx) => {
    const file = ctx.sessionManager.getSessionFile();
    if (file) { reporter.report('pi', file, ctx.cwd); reporter.status('pi', file, {state:'idle'}); }
  });
  for (const [name, state] of [['agent_start', 'working'], ['agent_end', 'done']])
    pi.on(name, (_event, ctx) => {
      const file = ctx.sessionManager.getSessionFile();
      if (file) reporter.status('pi', file, {state});
    });
  pi.on('session_shutdown', (_event, ctx) => {
    const file = ctx.sessionManager.getSessionFile();
    if (file) { reporter.report('pi', file, ctx.cwd, true); reporter.status('pi', file, null); }
  });
}
`,
  )
  ownedFile(
    join(opencode, 'plugins', 'dovo-terminal-recovery.js'),
    `
import reporter from ${module};
export const DovoTerminalRecovery = async ({ directory }) => {
 let current;
 const children = new Set();
 const remember = id => { current = id; reporter.report('opencode', id, directory); reporter.status('opencode', id, {state:'idle'}); };
 process.once('exit', () => { if (current) { reporter.report('opencode', current, directory, true); reporter.status('opencode', current, null); } });
 return {
  event: async ({ event }) => {
    if (event.type === 'session.created' && event.properties.info.parentID) {
      children.add(event.properties.info.id); return;
    }
    if (event.type === 'session.created' && !event.properties.info.parentID)
      remember(event.properties.info.id);
    const id = event.properties.sessionID ?? event.properties.info?.id;
    if (id !== current) return;
    if (event.type === 'session.deleted') {
      reporter.report('opencode', id, directory, true); reporter.status('opencode', id, null);
    }
    if (event.type === 'session.status') {
      const state = event.properties.status?.type;
      if (state === 'busy' || state === 'retry') reporter.status('opencode', id, {state:'working'});
      if (state === 'idle') reporter.status('opencode', id, {state:'done'});
    }
    if (event.type === 'session.idle') reporter.status('opencode', id, {state:'done'});
    if (event.type === 'session.error') reporter.status('opencode', id, {state:'error'});
    if (event.type === 'permission.asked') reporter.status('opencode', id, {state:'blocked',kind:'permission'});
    if (event.type === 'question.asked') reporter.status('opencode', id, {state:'blocked',kind:'question'});
    if (['permission.replied','question.replied','question.rejected'].includes(event.type)) reporter.status('opencode', id, {state:'working'});
  },
  'chat.message': async (input) => { if (!children.has(input.sessionID)) { remember(input.sessionID); reporter.status('opencode', input.sessionID, {state:'working'}); } },
 };
};
`,
  )
}
