import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { isDeepStrictEqual } from 'node:util'
import { Schema } from 'effect'
import { decode, terminalTurnIdPattern, terminalTurnIdHistoryLimit } from '@dovo/protocol'
import { parse, quote } from 'shell-quote'

const marker = '// Dovo terminal session recovery v1\n'
const objectSchema = Schema.Record(Schema.String, Schema.Unknown)
function object(value: unknown) {
  return { ...decode(objectSchema, value) }
}
function ownedFile(path: string, source: string) {
  const content = marker + source
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (stat) {
    const previous = stat.isFile() ? readFileSync(path, 'utf8') : ''
    if (previous === content) return
    if (!previous.startsWith(marker))
      throw new Error(`Recovery integration already exists and is not owned by Dovo: ${path}`)
  }
  atomicFile(path, content)
}
function atomicFile(path: string, source: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, source, { mode: 0o600 })
  renameSync(temporary, path)
}
type HookProvider = 'codex' | 'claude'

function hookCommand(executable: string, reporter: string, provider: HookProvider) {
  return process.platform === 'win32'
    ? `set "ELECTRON_RUN_AS_NODE=1" && "${executable}" "${reporter}" ${provider}`
    : `ELECTRON_RUN_AS_NODE=1 ${quote([executable, reporter, provider])}`
}

function ownedReporter(file: string) {
  // A hook may point to an arbitrary user path. Read only the marker of a regular file.
  let fd: number | undefined
  try {
    if (!lstatSync(file, { throwIfNoEntry: false })?.isFile()) return false
    fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
    if (!fstatSync(fd).isFile()) return false
    const header = Buffer.alloc(marker.length)
    return (
      readSync(fd, header, 0, header.length, 0) === header.length && header.toString() === marker
    )
  } catch {
    // A missing, unreadable or redirected legacy file cannot establish ownership.
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function ownedHookCommand(source: string, provider: HookProvider) {
  let executable: string, reporter: string
  if (process.platform === 'win32') {
    const match = /^set "ELECTRON_RUN_AS_NODE=1" && "([^"]+)" "([^"]+)" (?:codex|claude)$/.exec(
      source,
    )
    if (!match) return false
    executable = match[1]!
    reporter = match[2]!
  } else {
    if (!source.startsWith('ELECTRON_RUN_AS_NODE=1 ')) return false
    let words: ReturnType<typeof parse>
    try {
      words = parse(source)
    } catch {
      return false
    }
    if (words.length !== 4 || typeof words[1] !== 'string' || typeof words[2] !== 'string')
      return false
    executable = words[1]
    reporter = words[2]
  }
  return (
    isAbsolute(executable) &&
    isAbsolute(reporter) &&
    basename(reporter) === 'report.cjs' &&
    source === hookCommand(executable, reporter, provider) &&
    ownedReporter(reporter)
  )
}

function hookGroup(command: string) {
  return { hooks: [{ type: 'command', command, timeout: 3 }] }
}

function addHooks(
  path: string,
  provider: HookProvider,
  reporter: string,
  events: readonly string[],
) {
  const config = existsSync(path) ? object(JSON.parse(readFileSync(path, 'utf8'))) : {}
  const hooks = config.hooks === undefined ? {} : object(config.hooks)
  const command = hookCommand(process.execPath, reporter, provider)
  const owned = new Map<string, boolean>([[command, true]])
  let changed = false
  for (const name of events) {
    const groups =
      hooks[name] === undefined ? [] : decode(Schema.Array(Schema.Unknown), hooks[name])
    let found = false
    const next: unknown[] = []
    for (const group of groups) {
      const handlers =
        group && typeof group === 'object' && 'hooks' in group ? group.hooks : undefined
      const handler: unknown = Array.isArray(handlers) ? handlers[0] : undefined
      const source =
        handler && typeof handler === 'object' && 'command' in handler ? handler.command : undefined
      if (typeof source === 'string' && isDeepStrictEqual(group, hookGroup(source))) {
        if (!owned.has(source)) owned.set(source, ownedHookCommand(source, provider))
        if (owned.get(source)) {
          if (!found) next.push(hookGroup(command))
          found = true
          continue
        }
      }
      next.push(group)
    }
    if (!found) next.push(hookGroup(command))
    if (!isDeepStrictEqual(next, groups)) {
      hooks[name] = next
      changed = true
    }
  }
  if (changed) {
    config.hooks = hooks
    atomicFile(path, JSON.stringify(config, null, 2) + '\n')
  }
}

// Each provider config owns its reporter. The terminal's environment selects the runtime.
// The tools report activity through their lifecycle APIs.
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
// Each contender publishes its own nonempty directory. Renaming one shared file
// can let concurrent Windows renames move the same open file more than once.
function withStatusLock(root, write) {
  const lock = path.join(root, 'activity.lock', 'writer');
  const owner = process.pid + '.' + require('node:crypto').randomUUID();
  const temporary = lock + '.' + owner;
  const wait = new Int32Array(new SharedArrayBuffer(4));
  const deadline = performance.now() + 2000; // provider hook timeout is three seconds
  fs.mkdirSync(path.dirname(lock), {recursive:true, mode:0o700});
  fs.mkdirSync(temporary, {mode:0o700});
  const directoryChanging = error => ['ENOENT', 'EACCES', 'EPERM'].includes(error.code);
  const removeEmptyLock = () => {
    try { fs.rmdirSync(lock); }
    catch (error) {
      // Another writer can be removing or replacing this directory. Only a
      // successful rename below grants ownership, even if removal is deferred.
      if (!directoryChanging(error) && !['ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    }
  };
  try {
    fs.writeFileSync(path.join(temporary, owner), '', {mode:0o600});
    for (;;) {
      try { fs.renameSync(temporary, lock); break; }
      catch (error) {
        // Windows reports an existing destination directory as a permissions error.
        if (!['ENOTEMPTY', 'EEXIST', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      }
      let names;
      try { names = fs.readdirSync(lock); }
      catch (error) {
        // Windows can deny a directory read while another writer removes it.
        // Go through the bounded acquisition loop again without assuming we own it.
        if (!directoryChanging(error)) throw error;
      }
      if (names) {
        for (const name of names) {
          const match = /^(\d+)\.[a-f0-9-]+$/.exec(name);
          if (!match) continue;
          try { process.kill(Number(match[1]), 0); }
          catch (error) {
            if (error.code === 'EPERM' || error.code === 'EACCES') continue;
            if (error.code !== 'ESRCH') throw error;
            // Only remove the dead writer's unique marker. The directory may
            // already belong to a different writer by the time cleanup runs.
            fs.rmSync(path.join(lock, name), {force:true});
          }
        }
        if (names.length === 0) removeEmptyLock();
      }
      if (performance.now() >= deadline) throw new Error('Timed out waiting for the terminal activity writer');
      Atomics.wait(wait, 0, 0, 5);
    }
    try { if (!fs.existsSync(path.join(root, 'closing'))) write(); }
    finally {
      fs.rmSync(path.join(lock, owner), {force:true});
      removeEmptyLock();
    }
  } finally {
    fs.rmSync(temporary, {recursive:true, force:true});
  }
}
// Hook stdout is captured by agent CLIs. Publish to the owning terminal's private
// status file instead of printing escape sequences into hook output.
exports.status = function(provider, sessionId, activity, turnId = activity?.turnId) {
  const root = process.env.DOVO_TERMINAL_STATUS_DIRECTORY || process.env.DOVO_TERMINAL_RECOVERY_DIRECTORY;
  if (!root || !fs.existsSync(root) || fs.existsSync(path.join(root, 'closing'))) return;
  if (process.env.TMUX || process.env.HC_SCOPE) return;
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 4000 || /[\x00-\x1f\x7f]/.test(sessionId)) return;
  // Keep a legacy state report usable when a provider sends an invalid identifier.
  if (typeof turnId !== 'string' || !${terminalTurnIdPattern}.test(turnId)) turnId = undefined;
  withStatusLock(root, () => {
    const file = path.join(root, 'activity.json');
    let previous;
    if (fs.existsSync(file)) {
      previous = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (previous.provider !== provider || previous.sessionId !== sessionId) {
        if (!activity || activity.state !== 'idle') return;
      }
    }
    // More reports can arrive between polls than fit in the transition history.
    // Keep a bounded count of independent jobs at the source as well.
    const wasWorking = previous?.activity?.state === 'working';
    const working = activity?.state === 'working';
    const previousTurnId = previous?.activity?.turnId ?? previous?.turnId;
    const id = turnId ?? (!working && wasWorking ? previousTurnId : undefined);
    let openTurns = previous?.openTurns ?? (wasWorking && previousTurnId ? [previousTurnId] : []);
    let completedTurns = previous?.completedTurns ?? [];
    // Positions line up with completedTurns. An older writer has IDs without positions.
    let completionPositions = previous?.completionPositions ?? completedTurns.map(() => null);
    const sequence = (previous?.sequence ?? 0) + 1;
    let turn = previous?.turn ?? 0;
    if (id) {
      if (!completedTurns.includes(id)) {
        const open = openTurns.includes(id);
        if (working && !open) openTurns = [...openTurns, id].slice(-${terminalTurnIdHistoryLimit});
        if (!working && (open || (wasWorking && !previousTurnId))) {
          turn++;
          if (open) openTurns = openTurns.filter(value => value !== id);
          completedTurns = [...completedTurns, id].slice(-${terminalTurnIdHistoryLimit});
          completionPositions = [...completionPositions, [sequence, turn]].slice(-${terminalTurnIdHistoryLimit});
        }
      }
    } else if (wasWorking && !working) turn++;
    const transitions = previous?.transitions ?? [];
    if (previous?.sequence !== undefined && (previous.activity?.state !== activity?.state || previousTurnId !== turnId)) {
      // Keep recent state boundaries so the holder can merge both sources between polls.
      transitions.push({sequence:previous.sequence, turn:previous.turn, state:previous.activity?.state ?? null, turnId:previousTurnId});
    }
    const temporary = file + '.' + process.pid + '.' + require('node:crypto').randomUUID();
    const event = {
      id: require('node:crypto').randomUUID(), at: Date.now(), turn, sequence, provider, sessionId,
      openTurns: openTurns.length ? openTurns : undefined,
      completedTurns: completedTurns.length ? completedTurns : undefined,
      completionPositions: completionPositions.length ? completionPositions : undefined,
      transitions: transitions.slice(-32), turnId: activity ? undefined : turnId,
      activity: activity && {...activity, turnId, app:provider},
    };
    fs.writeFileSync(temporary, JSON.stringify(event), {mode:0o600});
    fs.renameSync(temporary, file);
  });
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
  if (activity !== undefined) {
    // Session lifecycle hooks are outside a user turn. Claude can include the last prompt ID.
    const turnId = name === 'SessionStart' || name === 'SessionEnd' ? undefined
      : provider === 'codex' ? event.turn_id : provider === 'claude' ? event.prompt_id : undefined;
    exports.status(provider, event.session_id, activity, turnId);
  }
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

export type RecoveryIntegrationProvider = 'codex' | 'claude' | 'pi' | 'opencode'
export type RecoveryIntegrationFailure = {
  provider: RecoveryIntegrationProvider
  message: string
}

/**
 * Installs the shared reporter and launchers, then each provider integration on its own. Throws
 * when the shared files fail. Returns failed providers. Their files stay unchanged.
 */
export function installRecoveryIntegrations(
  directory: string,
  environment: NodeJS.ProcessEnv = process.env,
): RecoveryIntegrationFailure[] {
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
  const codex = environment.CODEX_HOME || join(homedir(), '.codex')
  const claude = environment.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const pi = environment.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent')
  const opencode = join(environment.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode')
  const configReporter = (config: string) => {
    const path = resolve(config, 'dovo-terminal-recovery', 'report.cjs')
    ownedFile(path, recoveryReporterSource)
    return path
  }
  // Each provider owns its own config. A user file that Dovo cannot read must not stop the others.
  const failures: RecoveryIntegrationFailure[] = []
  const install = (provider: RecoveryIntegrationProvider, write: () => void) => {
    try {
      write()
    } catch (error) {
      failures.push({ provider, message: error instanceof Error ? error.message : String(error) })
    }
  }
  install('codex', () =>
    addHooks(join(codex, 'hooks.json'), 'codex', configReporter(codex), [
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PermissionRequest',
      'Stop',
      'Interrupt',
    ]),
  )
  install('claude', () =>
    addHooks(join(claude, 'settings.json'), 'claude', configReporter(claude), [
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
    ]),
  )
  install('pi', () => {
    configReporter(pi)
    ownedFile(
      join(pi, 'extensions', 'dovo-terminal-recovery.ts'),
      `
import reporter from '../dovo-terminal-recovery/report.cjs';
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
  })
  install('opencode', () => {
    configReporter(opencode)
    ownedFile(
      join(opencode, 'plugins', 'dovo-terminal-recovery.js'),
      `
import reporter from '../dovo-terminal-recovery/report.cjs';
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
  })
  return failures
}
