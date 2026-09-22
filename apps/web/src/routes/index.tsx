import { createRoute } from '@tanstack/react-router'
import { Route as rootRoute } from './__root'
import { Workbench } from '@dovo/studio-shell'
import { tasksExtension } from '@dovo/extension-tasks'
import { scmExtension } from '@dovo/extension-scm'
import { agentsExtension } from '@dovo/extension-agents'
import { jobsExtension } from '@dovo/extension-jobs'
import { runtimeExtension } from '@dovo/extension-runtime'
const extensions = [tasksExtension, scmExtension, agentsExtension, jobsExtension, runtimeExtension]
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <Workbench extensions={extensions} />,
})
