import { LiveActivities } from './notifications/live-activities.js'
import { TitleGeneration } from './agents/title-generation.js'
import { Attachments } from './storage/attachments.js'
import { Activity } from './storage/activity.js'
import { PullCache } from './scm/pull-cache.js'
import { ForgePullRequests } from './scm/forge-pulls.js'
import { ForgeCliAccounts } from './scm/forge-cli-accounts.js'
import { ForgeWork } from './scm/forge-work.js'
import { ForgeConnections } from './scm/forge-connections.js'
import { Commands } from './storage/commands.js'
import { TaskCheckout } from './scm/task-checkout.js'
import type Database from 'better-sqlite3'
import { WorkspaceStore } from './storage/workspace.js'
import { Devices } from './auth/devices.js'
import { Pairing } from './auth/pairing.js'
import { GitService } from './scm/git.js'
import { Terminals } from './terminal/terminals.js'
import { AgentRegistry } from './agents/registry.js'
import { Approvals } from './agents/approvals.js'
import { Questions } from './agents/questions.js'
import { Tasks } from './agents/tasks.js'
import { Jobs } from './jobs/jobs.js'
import { SocketTickets } from './http/socket-tickets.js'
import { SimulatorPreviews } from './previews/simulators.js'
import { RemoteBrowsers } from './previews/browser.js'
export function createServices(db: Database.Database, ownerToken: string): Services {
  const activity = new Activity(db)
  const commands = new Commands(db)
  const store = new WorkspaceStore(db, (before, after) => activity.workspace(before, after))
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
    agents = new AgentRegistry(() => commands.get()),
    approvals = new Approvals(activity),
    questions = new Questions(activity),
    tickets = new SocketTickets()
  activity.workspace({ ...store.get(), tasks: [] }, store.get())
  const attachments = new Attachments(db, store, activity)
  const pullCache = new PullCache(db, pulls, store, (cwd, refresh) => pulls.identity(cwd, refresh))
  const checkouts = new TaskCheckout(store, git)
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
    ),
    jobs = new Jobs(db, store, tasks, activity)
  const liveActivities = new LiveActivities(
    db,
    store,
    devices,
    (id) =>
      approvals.list().some((item) => item.taskId === id) ||
      questions.list().some((item) => item.taskId === id),
  )
  return {
    liveActivities,
    forges,
    forgeCli,
    forgeWork: new ForgeWork(db, store, git, forges, pulls, () => commands.get()),
    db,
    titles: new TitleGeneration(db, store, agents),
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
    browsers: new RemoteBrowsers(),
    browserTickets: new SocketTickets(),
    checkouts,
  }
}
export interface Services {
  liveActivities: LiveActivities
  forgeCli: ForgeCliAccounts
  forgeWork: ForgeWork
  forges: ForgeConnections
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
}
