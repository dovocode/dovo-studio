import { indexTaskFamilyWorking } from '@dovo/protocol'
import { PeerConnections } from './http/peer-connections.js'
import { RemoteDesktop } from './computer-use/remote-desktop.js'
import { familyWatchCounts } from './studio/thread-snapshot.js'
import type { ThreadWatchEntry } from '@dovo/protocol'
import { ThreadWatch } from './studio/thread-watch.js'
import { routedStudioTool } from './studio/peers.js'
import { SharedRetrieval } from './retrieval/coordinator.js'
import { RetrievalPeers } from './retrieval/peers.js'
import { ProjectTransfers } from './scm/repositories/project-transfers.js'
import { enabledStudioTools } from '@dovo/protocol'
import { ModelSelection } from './agents/tasks/model-selection.js'
import { runCredentials, type RunCredentials } from './auth/run-credentials.js'
import { permissionPolicyReadOnly } from '@dovo/protocol'
import { resolveTaskAgent } from '@dovo/protocol'
import { TaskReviews } from './scm/reviews/task-reviews.js'
import { ReviewMarks } from './scm/reviews/progress.js'
import { FileReviews, pullReviewScope, pullReviewFiles } from './scm/reviews/reviews.js'
import { DeviceHosts, splitDeviceId } from './previews/device-hosts.js'
import { previewDevices } from './previews/devices.js'
import { DeviceHostUploads } from './previews/device-host-install.js'
import { Memory } from './memory/memory.js'
import { RuntimeBackups } from './storage/backups.js'
import { MutationReceipts } from './storage/mutation-receipts.js'
import { McpApps } from './mcp-apps/bridge.js'
import { Artifacts } from './artifacts/artifacts.js'
import { ArtifactFeeds } from './artifacts/feeds.js'
import { SharedThreads } from './studio/shared-threads.js'
import { ScratchWorkspaces } from './scm/repositories/scratch-workspaces.js'
import { AcpInstallations } from './agents/configuration/acp-installations.js'
import type { ExternalListener } from './http/external-listener.js'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { RuntimeDefaults } from './storage/runtime-defaults.js'
import { RuntimePreferences } from './storage/runtime-preferences.js'
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
import { cliRead } from './scm/git/command-read.js'
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
  db.prepare("INSERT OR IGNORE INTO documents (id, value) VALUES ('runtime-identity', ?)").run(
    JSON.stringify(randomUUID()),
  )
  const identity = db
    .prepare("SELECT value FROM documents WHERE id = 'runtime-identity'")
    .pluck()
    .get()
  if (typeof identity !== 'string') throw new Error('Missing runtime identity')
  const runtimeId: unknown = JSON.parse(identity)
  if (typeof runtimeId !== 'string' || !runtimeId)
    throw new Error('Invalid persisted runtime identity')
  const activity = new Activity(db)
  const commands = new Commands(db)
  const preferences = new RuntimePreferences(db, () => store.update((workspace) => workspace))
  const deviceHostUploads = new DeviceHostUploads()
  const deviceHosts = new DeviceHosts(
    db,
    (id) => simulators.closeHost(id),
    () => simulators.closeAll(),
    () => deviceHostUploads.cancelAll(),
  )
  const simulators = new SimulatorPreviews({
    authorize: () => deviceHosts.assertEnabled(),
    devices: (taskId, deviceId, foreignOwner) => {
      const selected = splitDeviceId(deviceId)
      return foreignOwner || !selected.hostId
        ? previewDevices(deviceId)
        : deviceHosts.list(taskId, selected.hostId, false, selected.id)
    },
    driver: (taskId, device, authorize, signal) =>
      deviceHosts.driver(taskId, device, authorize, signal),
  })
  const defaults = new RuntimeDefaults(db)
  const acpInstallations = new AcpInstallations(
    db,
    db.name === ':memory:'
      ? join(tmpdir(), `dovo-acp-${randomUUID()}`)
      : join(dirname(resolve(db.name)), 'acp'),
  )
  let artifacts: Artifacts | undefined
  const store = new WorkspaceStore(db, (change) => {
    activity.workspace(change)
    artifacts?.workspace(change)
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
  // Devices may expire during construction, before the peer service exists. Once started,
  // revocation closes encrypted streams synchronously rather than waiting for the reaper.
  let peerConnections: PeerConnections | undefined
  const devices = new Devices(db, ownerToken, (id) => {
      peerConnections?.internet.revoke(id)
      peerConnections?.disable(id)
      mutations.revoke(id)
      deviceHostUploads.cancelDevice(id)
      void simulators
        .closeForeignDevice(id)
        .catch((error) => console.warn('Revoked device preview cleanup failed', error))
    }),
    pairing = new Pairing(devices),
    git: GitService = new GitService(
      () => commands.get(),
      (cwd, args, result) => {
        // Do not persist either edge of routine reads. A failed read still retains
        // its command and error; writes and unknown commands retain their audit.
        if (result?.error === undefined && cliRead(args, commands.get())) return
        activity.add(
          'command',
          cwd,
          `${args[0] ?? 'command'} · ${result ? (result.error ? 'failed' : 'completed') : 'started'}`,
          { args, ...result },
        )
      },
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
    approvals = new Approvals(activity, store, preferences),
    questions = new Questions(activity, store),
    tickets = new SocketTickets()
  // Task and message activity is recorded as the store changes. Replaying the stored
  // workspace here would resurrect pruned rows and duplicate task events on every start.
  const attachments = new Attachments(db, store, activity)
  const reviewMarks = new ReviewMarks(db)
  const pullCache = new PullCache(
    db,
    pulls,
    store,
    (cwd, refresh) => pulls.identity(cwd, refresh),
    (detail) => {
      if (!detail.warnings.some((warning) => warning.startsWith('Files:')))
        reviewMarks.reconcile(pullReviewScope(detail), pullReviewFiles(detail))
    },
  )
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
  const fileReviews = new FileReviews({ store, git, checkouts, pullCache, reviewMarks })
  const memory = new Memory(db, store, preferences, checkouts)
  const titles = new TitleGeneration(db, store, agents, checkouts)
  const modelSelection = new ModelSelection(db, store, agents, titles, () =>
    acpInstallations.list(),
  )
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
      (id, text) => modelSelection.resolveEffect(id, text),
      () => enabledStudioTools(preferences.get()),
      () => preferences.get().enableLinkedProjectsTool,
    ),
    jobs = new Jobs(db, store, tasks, activity, (text) => titles.generate({ text }), git)
  const taskReviews = new TaskReviews(db, { store, tasks, git, checkouts, activity })
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
          prompt: question.prompt,
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
  const retrievalPeers = new RetrievalPeers(db, devices)
  const retrieval = new SharedRetrieval(
    db,
    () => ({
      id: runtimeId,
      role: preferences.get().runtimeIcon,
      enabled: preferences.get().enableSharedRetrieval !== false,
      preferredHost: preferences.get().preferredRetrievalHost,
    }),
    () => retrievalPeers.list(),
  )
  git.retrieval = retrieval
  pulls.communication = retrieval
  const forgeWork = new ForgeWork(db, store, git, forges, pulls, () => commands.get())
  const pullRequestWatch = new PullRequestWatch(db, {
    pulls,
    store,
    preferences,
    pullCache,
    tasks,
    activity,
  })
  forgeWork.retrieval = retrieval
  retrieval.onInvalidate = () => {
    forgeWork.invalidateShared()
    for (const repo of store.get().repositories) pullCache.invalidate(repo.path)
  }
  const pipelineWatch = new PipelineWatch(db, {
    pulls,
    store,
    preferences,
    forgeWork,
    tasks,
    activity,
  })
  const threadWatch = new ThreadWatch(
    db,
    { store, preferences, tasks },
    (parentId, runtimeId, threadId, policy) =>
      routedStudioTool(
        services,
        parentId,
        'threads',
        { action: 'snapshot', id: threadId },
        runtimeId,
        () => {},
        policy,
        undefined,
        true,
      ),
    (parentId, runtimeId, threadId, policy) =>
      routedStudioTool(
        services,
        parentId,
        'threads',
        { action: 'stop', id: threadId },
        runtimeId,
        () => {},
        policy,
      ),
  )
  tasks.onStopChildren = (parentId) => threadWatch.requestChildStop(parentId)
  // Older runtimes retained watches on settled threads; do not resume those after an upgrade.
  pullRequestWatch.reconcile(store.get().tasks)
  pipelineWatch.reconcile(store.get().tasks)
  store.setTaskWatchLifecycle((entries, agents) => {
    const pulls = pullRequestWatch.reconcile(entries)
    const pipelines = pipelineWatch.reconcile(entries)
    const settings = preferences.get()
    const remote = threadWatch.reconcile(entries, agents)
    const pipelineCounts = pipelineWatch.countsByTask(),
      pullCounts = pullRequestWatch.countsByTask()
    const counts = new Map(
      entries.map((task) => {
        const pipelines = pipelineCounts.get(task.id) ?? { active: 0, failures: 0 }
        const pulls = pullCounts.get(task.id) ?? { active: 0, failures: 0 }
        const result = {
          pipelines: permissionPolicyReadOnly(resolveTaskAgent(task, agents))
            ? 0
            : pipelines.active,
          pullRequests: permissionPolicyReadOnly(resolveTaskAgent(task, agents)) ? 0 : pulls.active,
          failures: pipelines.failures + pulls.failures,
        }
        return [
          task.id,
          {
            runtimeId,
            threadId: task.id,
            attention: [],
            watches: result,
            phase: 'completed',
            revision: '',
          } satisfies ThreadWatchEntry,
        ] as const
      }),
    )
    const rolled = familyWatchCounts(
      entries,
      counts,
      settings.enableStudioThreads ? remote : new Map(),
      runtimeId,
    )
    const familyWorking = indexTaskFamilyWorking(
      entries.map((task) => ({ ...task, threadWatches: remote.get(task.id) })),
    )
    return entries.map((task) => {
      const threadWatches = remote.get(task.id)
      const rolledCounts = rolled.get(task.id)
      const watchCounts =
        rolledCounts &&
        (rolledCounts.pipelines || rolledCounts.pullRequests || rolledCounts.failures)
          ? rolledCounts
          : undefined
      const remoteWaiting = threadWatches?.some(
        (watch) =>
          watch.status === 'watching' &&
          !watch.paused &&
          (watch.offline || watch.snapshot?.phase !== 'completed'),
      )

      const waiting =
        !task.archived &&
        !task.archivedAt &&
        (task.status === 'review' || task.status === 'done') &&
        !task.runPhase &&
        !task.activeRunId &&
        !task.queue?.length &&
        !task.draft.trim() &&
        !task.draftAttachments?.length &&
        !task.error &&
        (familyWorking(task.id) ||
          (!permissionPolicyReadOnly(resolveTaskAgent(task, agents)) &&
            ((settings.enablePullRequestWatching && pulls.has(task.id)) ||
              (settings.enablePipelineWatching && pipelines.has(task.id)) ||
              (settings.enableStudioThreads && remoteWaiting) ||
              !!(watchCounts?.pipelines || watchCounts?.pullRequests))))
      if (
        !!task.waitingForFeedback === waiting &&
        JSON.stringify(task.threadWatches) === JSON.stringify(threadWatches) &&
        JSON.stringify(task.watchCounts) === JSON.stringify(watchCounts)
      )
        return task
      return { ...task, waitingForFeedback: waiting || undefined, threadWatches, watchCounts }
    })
  })

  const services: Services = {
    projectTransfers: new ProjectTransfers(() => services, db),
    threadWatch,
    remoteDesktop: new RemoteDesktop(
      () => preferences.get().enableRemoteDesktop,
      () => commands.get().cua,
      () => activity.add('integration', 'remote-desktop', 'Remote desktop session changed', {}),
      (error) => console.error('Remote desktop cleanup failed:', error),
    ),
    runCredentials: runCredentials(store),
    fileReviews,
    taskReviews,
    reviewMarks,
    pipelineWatch,
    pullRequestWatch,
    backups: new RuntimeBackups(db.name),
    mutations,
    instanceId: randomUUID(),
    runtimeId,
    runtimeAddresses: () => [],
    peers: (peerConnections = new PeerConnections(db, devices)),
    mcpApps,
    artifacts,
    artifactFeeds: new ArtifactFeeds(
      db,
      artifacts,
      mcpApps,
      devices,
      store,
      () => preferences.get().enableArtifacts,
      () => {
        if (!peerConnections) throw new Error('Runtime connections are not initialized')
        return peerConnections.internet.origin
      },
    ),
    sharedThreads: new SharedThreads(
      db,
      store,
      devices,
      artifacts,
      () => services.artifactFeeds,
      mcpApps,
      () => preferences.get().enableArtifacts,
    ),
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
    retrieval,
    retrievalPeers,
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
  return services
}
export interface Services {
  projectTransfers: ProjectTransfers
  remoteDesktop: RemoteDesktop
  threadWatch: ThreadWatch
  runCredentials: RunCredentials
  memory: Memory
  backups: RuntimeBackups
  pipelineWatch: PipelineWatch
  pullRequestWatch: PullRequestWatch
  artifacts: Artifacts
  artifactFeeds: ArtifactFeeds
  sharedThreads: SharedThreads
  mutations: MutationReceipts
  mcpApps: McpApps
  instanceId: string
  runtimeId: string
  runtimeAddresses: () => string[]
  peers: PeerConnections
  scratch: ScratchWorkspaces
  network?: ExternalListener
  acpInstallations: AcpInstallations
  acpController: AbortController
  preferences: RuntimePreferences
  pushNotifications: PushNotifications
  liveActivities: LiveActivities
  forgeCli: ForgeCliAccounts
  retrieval: SharedRetrieval
  retrievalPeers: RetrievalPeers
  forgeWork: ForgeWork
  forges: ForgeConnections
  defaults: RuntimeDefaults
  titles: TitleGeneration
  activity: Activity
  taskReviews: TaskReviews
  fileReviews: FileReviews
  reviewMarks: ReviewMarks
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
