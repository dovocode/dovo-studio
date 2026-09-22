import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { Workbench } from '@dovo/studio-shell'
import { tasksExtension } from '@dovo/extension-tasks'
import { scmExtension } from '@dovo/extension-scm'
import { agentsExtension } from '@dovo/extension-agents'
import { jobsExtension } from '@dovo/extension-jobs'
import { runtimeExtension } from '@dovo/extension-runtime'
const extensions = [tasksExtension, scmExtension, agentsExtension, jobsExtension, runtimeExtension]
const root = document.getElementById('root')
if (!root) throw new Error('Missing application root')
createRoot(root).render(
  <StrictMode>
    <Workbench
      extensions={extensions}
      desktopPlatform={window.dovo?.platform}
      pickDirectory={window.dovo?.pickDirectory}
      browser={window.dovo?.browser}
    />
  </StrictMode>,
)
