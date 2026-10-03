import { MutationReceipts } from './storage/mutation-receipts.js'
import { McpApps } from './mcp-apps/bridge.js'
import { Artifacts } from './artifacts/artifacts.js'
import { ScratchWorkspaces } from './scm/repositories/scratch-workspaces.js'
import { AcpInstallations } from './agents/configuration/acp-installations.js'
import type { ExternalListener } from './http/external-listener.js'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { RuntimeDefaults } from './storage/runtime-defaults.js'
import { RuntimePreferences } from './storage/runtime-preferences.js'
import { Context } from 'effect'
import { PushNotifications } from './notifications/push.js'
import { LiveActivities } from './notifications/live-activities.js'
import { TitleGeneration } from './agents/tasks/title-generation.js'
import { Attachments } from './storage/attachments.js'
import { Activity } from './storage/activity.js'
import { PullCache } from './scm/pulls/pull-cache.js'
import { ForgePullRequests } from './scm/forges/integration/forge-pulls.js'
import { ForgeCliAccounts } from './scm/forges/integration/forge-cli-accounts.js'
import { ForgeWork } from './scm/work/forge-work.js'
import { ForgeConnections } from './scm/forges/integration/forge-connections.js'
import { Commands } from './storage/commands.js'
import { TaskCheckout } from './scm/tasks/task-checkout.js'
import type Database from 'better-sqlite3'
import { WorkspaceStore } from './storage/workspace.js'
import { Devices } from './auth/devices.js'
import { Pairing } from './auth/pairing.js'
import { GitService } from './scm/git/git.js'
import { Terminals } from './terminal/terminals.js'
import { AgentRegistry } from './agents/configuration/registry.js'
import { Approvals } from './agents/execution/approvals.js'
import { Questions } from './agents/execution/questions.js'
import { Tasks } from './agents/tasks/tasks.js'
import { Jobs } from './jobs/jobs.js'
import { SocketTickets } from './http/support/socket-tickets.js'
import { SimulatorPreviews } from './previews/simulators.js'
import { RemoteBrowsers } from './previews/browser.js'
import { ProjectFiles } from './scm/repositories/project-files.js'
export function createServices(db: Database.Database, ownerToken: string): Services {
  const activity = new Activity(db)
  const commands = new Commands(db)
  const preferences = new RuntimePreferences(db)
  const defaults = new RuntimeDefaults(db)
  const acpInstallations = new AcpInstallations(
    db,
    db.name === ':memory:'
      ? join(tmpdir(), `dovo-acp-${randomUUID()}`)
      : join(dirname(resolve(db.name)), 'acp'),
  )
  let artifacts: Artifacts | undefined
  const store = new WorkspaceStore(db, (before, after) => {
    activity.workspace(before, after)
    artifacts?.workspace(before, after)
  })
  artifacts = new Artifacts(db, store, activity, () => preferences.get())
  const forgeCli = new ForgeCliAccounts(() => commands.get())
  const forges = new ForgeConnections(
    db,
    (id, revision) => {
      if (!store.get().repositories.some((repo) => repo.forge?.connectionId === id)) return
      store.update((workspace) => ({
        ...workspace,
        repositories: workspace.repositories.map((repo) =>
          repo.forge?.connectionId === id ? { ...repo, forge: { ...repo.forge, revision } } : repo,
        ),
      }))
    },
    forgeCli,
    (fn) => store.transaction(fn),
  )
  const devices = new Devices(db, ownerToken),
    pairing = new Pairing(devices),
    git = new GitService(
      () => commands.get(),
      (cwd, args, result) =>
        activity.add(
          'command',
          cwd,
          `${args[0] ?? 'command'} · ${result ? (result.error ? 'failed' : 'completed') : 'started'}`,
          { args, ...result },
        ),
      (connectionId, remote, cwd) => forges.gitAuthorization(connectionId, remote, cwd),
    ),
    pulls = new ForgePullRequests(git, forges, store),
    terminals = new Terminals(() => commands.get(), activity),
    agents = new AgentRegistry(
      () => commands.get(),
      (id) => acpInstallations.launch(id),
    ),
    approvals = new Approvals(activity, store),
    questions = new Questions(activity, store),
    tickets = new SocketTickets()
  // Task and message activity is recorded as the store changes. Replaying the stored
  // workspace here would resurrect pruned rows and duplicate task events on every start.
  const attachments = new Attachments(db, store, activity)
  const pullCache = new PullCache(db, pulls, store, (cwd, refresh) => pulls.identity(cwd, refresh))
  const scratch = new ScratchWorkspaces(
    db.name === ':memory:'
      ? join(tmpdir(), `dovo-scratch-${randomUUID()}`)
      : join(dirname(resolve(db.name)), 'scratch'),
    store,
    git,
  )
  const checkouts = new TaskCheckout(store, git, () => preferences.get().branchPrefix, scratch)
  const titles = new TitleGeneration(db, store, agents)
  const tasks = new Tasks(
      store,
      git,
      agents,
      approvals,
      checkouts,
      commands,
      questions,
      attachments,
      activity,
      () => preferences.get().enableArtifacts,
      db.name === ':memory:'
        ? join(tmpdir(), 'dovo-catalog-skills')
        : join(dirname(resolve(db.name)), 'skills'),
    ),
    jobs = new Jobs(db, store, tasks, activity, (text) => titles.generate({ text }))
  const mcpApps = new McpApps(db, store, activity, approvals)
  tasks.setMcpApps(mcpApps)
  mcpApps.setSendMessage((taskId, messageId, text) => tasks.send(taskId, messageId, text))
  const liveActivities = new LiveActivities(
    db,
    store,
    devices,
    (id) =>
      approvals.list().some((item) => item.taskId === id) ||
      questions.list().some((item) => item.taskId === id),
  )
  const pushNotifications = new PushNotifications(db, store, devices, (id) => {
    return [
      ...questions
        .list()
        .filter((item) => item.taskId === id)
        .map((question) => ({
          id: question.id,
          type: 'question' as const,
          preview: [
            question.prompt.title,
            ...question.prompt.questions.filter((q) => !q.secret).map((q) => q.question),
          ].join(' · '),
        })),
      ...approvals
        .list()
        .filter((item) => item.taskId === id)
        .map((approval) => ({
          id: approval.id,
          type: 'approval' as const,
          preview: approval.title,
        })),
    ]
  })
  return {
    mutations: new MutationReceipts(db),
    instanceId: randomUUID(),
    mcpApps,
    artifacts,
    scratch,
    pushNotifications,
    acpInstallations,
    acpController: new AbortController(),
    preferences,
    defaults,
    liveActivities,
    forges,
    forgeCli,
    forgeWork: new ForgeWork(db, store, git, forges, pulls, () => commands.get()),
    db,
    titles,
    activity,
    commands,
    pulls,
    pullCache,
    store,
    devices,
    pairing,
    git,
    terminals,
    agents,
    approvals,
    questions,
    attachments,
    tasks,
    jobs,
    tickets,
    simulators: new SimulatorPreviews(),
    simulatorTickets: new SocketTickets(),
    browsers: new RemoteBrowsers(
      db.name === ':memory:' ? undefined : join(dirname(resolve(db.name)), 'browser-profiles'),
    ),
    browserTickets: new SocketTickets(),
    checkouts,
    projectFiles: new ProjectFiles(git),
  }
}
export interface Services {
  artifacts: Artifacts
  mutations: MutationReceipts
  mcpApps: McpApps
  instanceId: string
  scratch: ScratchWorkspaces
  network?: ExternalListener
  acpInstallations: AcpInstallations
  acpController: AbortController
  preferences: RuntimePreferences
  pushNotifications: PushNotifications
  liveActivities: LiveActivities
  forgeCli: ForgeCliAccounts
  forgeWork: ForgeWork
  forges: ForgeConnections
  defaults: RuntimeDefaults
  titles: TitleGeneration
  activity: Activity
  pullCache: PullCache
  pulls: ForgePullRequests
  commands: Commands
  checkouts: TaskCheckout
  db: Database.Database
  store: WorkspaceStore
  devices: Devices
  pairing: Pairing
  git: GitService
  terminals: Terminals
  agents: AgentRegistry
  approvals: Approvals
  attachments: Attachments
  questions: Questions
  tasks: Tasks
  jobs: Jobs
  tickets: SocketTickets
  simulators: SimulatorPreviews
  simulatorTickets: SocketTickets
  browsers: RemoteBrowsers
  browserTickets: SocketTickets
  projectFiles: ProjectFiles
}

export class RuntimeServices extends Context.Tag('dovo/RuntimeServices')<
  RuntimeServices,
  Services
>() {}
