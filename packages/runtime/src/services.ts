import { DeviceHosts, splitDeviceId } from './previews/device-hosts.js'
import { previewDevices } from './previews/devices.js'
import { DeviceHostUploads } from './previews/device-host-install.js'
import { Memory } from './memory/memory.js'
import { RuntimeBackups } from './storage/backups.js'
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
import { PipelineWatch } from './scm/tasks/pipeline-watch.js'
import { PullRequestWatch } from './scm/tasks/pull-request-watch.js'
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
  const deviceHostUploads = new DeviceHostUploads()
  const deviceHosts = new DeviceHosts(
    db,
    (id) => simulators.closeHost(id),
    () => simulators.closeAll(),
    () => deviceHostUploads.cancelAll(),
  )
  const simulators = new SimulatorPreviews({
    authorize: () => deviceHosts.assertEnabled(),
    devices: (taskId, deviceId, foreignOwner) =>
      foreignOwner || !splitDeviceId(deviceId).hostId
        ? previewDevices()
        : deviceHosts.list(taskId, splitDeviceId(deviceId).hostId),
    driver: (taskId, device) => deviceHosts.driver(taskId, device),
  })
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
  const mutations = new MutationReceipts(db)
  const devices = new Devices(db, ownerToken, (id) => {
      mutations.revoke(id)
      deviceHostUploads.cancelDevice(id)
      void simulators
        .closeForeignDevice(id)
        .catch((error) => console.warn('Revoked device preview cleanup failed', error))
    }),
    pairing = new Pairing(devices),
    git: GitService = new GitService(
      () => commands.get(),
      (cwd, args, result) =>
        activity.add(
          'command',
          cwd,
          `${args[0] ?? 'command'} · ${result ? (result.error ? 'failed' : 'completed') : 'started'}`,
          { args, ...result },
        ),
      (connectionId, remote, cwd) => forges.gitAuthorization(connectionId, remote, cwd),
      (cwd) => pulls.githubEnvironment(cwd),
      (common, directory) => store.rememberWorktree(common, directory),
    ),
    pulls: ForgePullRequests = new ForgePullRequests(git, forges, store),
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
  const checkouts = new TaskCheckout(
    store,
    git,
    () => preferences.get().branchPrefix,
    scratch,
    () => preferences.worktreesRoot(),
  )
  const memory = new Memory(db, store, preferences, checkouts)
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
      () => preferences.get().enablePullRequestWatching,
      () => preferences.get().enablePipelineWatching,
      (taskId) => memory.availableScopes(taskId),
      () => preferences.get().maxActiveChildAgents,
      () => deviceHosts.settings.get().enabled ?? false,
    ),
    jobs = new Jobs(db, store, tasks, activity, (text) => titles.generate({ text }), git)
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
  const forgeWork = new ForgeWork(db, store, git, forges, pulls, () => commands.get())
  const pullRequestWatch = new PullRequestWatch(db, {
    store,
    preferences,
    pullCache,
    tasks,
    activity,
  })
  const pipelineWatch = new PipelineWatch(db, { store, preferences, forgeWork, tasks, activity })
  // Older runtimes retained watches on settled threads; do not resume those after an upgrade.
  pullRequestWatch.reconcile(store.get().tasks)
  pipelineWatch.reconcile(store.get().tasks)
  store.setTaskWatchLifecycle((entries) => {
    const pulls = pullRequestWatch.reconcile(entries)
    const pipelines = pipelineWatch.reconcile(entries)
    return entries.map((task) => {
      const waiting =
        !task.archived &&
        !task.archivedAt &&
        (task.status === 'review' || task.status === 'done') &&
        !task.runPhase &&
        !task.queue?.length &&
        !task.draft.trim() &&
        !task.draftAttachments?.length &&
        !task.error &&
        (pulls.has(task.id) || pipelines.has(task.id))
      return !!task.waitingForFeedback === waiting
        ? task
        : { ...task, waitingForFeedback: waiting || undefined }
    })
  })

  return {
    pipelineWatch,
    pullRequestWatch,
    backups: new RuntimeBackups(db.name),
    mutations,
    instanceId: randomUUID(),
    mcpApps,
    artifacts,
    memory,
    scratch,
    pushNotifications,
    acpInstallations,
    acpController: new AbortController(),
    preferences,
    defaults,
    liveActivities,
    forges,
    forgeCli,
    forgeWork,
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
    simulators,
    deviceHosts,
    hostSimulators: simulators,
    deviceHostTickets: new SocketTickets(),
    deviceHostUploads,
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
  memory: Memory
  backups: RuntimeBackups
  pipelineWatch: PipelineWatch
  pullRequestWatch: PullRequestWatch
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
  deviceHosts: DeviceHosts
  hostSimulators: SimulatorPreviews
  deviceHostTickets: SocketTickets
  deviceHostUploads: DeviceHostUploads
  simulators: SimulatorPreviews
  simulatorTickets: SocketTickets
  browsers: RemoteBrowsers
  browserTickets: SocketTickets
  projectFiles: ProjectFiles
}

export class RuntimeServices extends Context.Service<RuntimeServices, Services>()(
  'dovo/RuntimeServices',
) {}
