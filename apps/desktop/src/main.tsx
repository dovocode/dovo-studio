import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { ApplicationStateProvider } from '@dovo/studio-core/state'
import { InputPreviewWindow } from './input-preview'
import { Workbench, TaskLauncherWindow } from '@dovo/studio-shell'
import { tasksExtension } from '@dovo/extension-tasks'
import { scmExtension } from '@dovo/extension-scm'
import { agentsExtension } from '@dovo/extension-agents'
import { jobsExtension } from '@dovo/extension-jobs'
import { runtimeExtension, WindowsRuntimeGate } from '@dovo/extension-runtime'
const extensions = [tasksExtension, scmExtension, agentsExtension, jobsExtension, runtimeExtension]
const root = document.getElementById('root')
if (!root) throw new Error('Missing application root')
createRoot(root).render(
  <StrictMode>
    {window.location.hash === '#input-preview' ? (
      <ApplicationStateProvider>
        <InputPreviewWindow bridge={window.dovo.inputPreview} />
      </ApplicationStateProvider>
    ) : window.location.hash === '#task-launcher' ? (
      <TaskLauncherWindow bridge={window.dovo.taskLauncher} />
    ) : (
      <WindowsRuntimeGate>
        <Workbench
          extensions={extensions}
          appInfo={window.dovo?.appInfo}
          desktopPlatform={window.dovo?.platform}
          pickDirectory={window.dovo?.pickDirectory}
          browser={window.dovo?.browser}
          chooseLink={window.dovo?.chooseLink}
          openExternalLink={window.dovo?.openExternalLink}
          inputPreview={window.dovo?.inputPreview}
          taskLauncher={window.dovo?.taskLauncher}
          updates={window.dovo?.updates}
        />
      </WindowsRuntimeGate>
    )}
  </StrictMode>,
)
