import { decode, threadWindowTargetSchema } from '@dovo/protocol'
import { StrictMode } from 'react'
import { useAccount, useAppPreferences } from '@dovo/studio-core'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { ApplicationStateProvider } from '@dovo/studio-core/state'
import { InputPreviewWindow } from './input-preview'
import { Workbench, TaskLauncherWindow } from '@dovo/studio-shell'
import { tasksExtension } from '@dovo/extension-tasks'
import { ThreadShare } from '@dovo/extension-tasks/thread-share'
import { scmExtension } from '@dovo/extension-scm'
import { agentsExtension } from '@dovo/extension-agents'
import { jobsExtension } from '@dovo/extension-jobs'
import { runtimeExtension, WindowsRuntimeGate } from '@dovo/extension-runtime'
const extensions = [tasksExtension, scmExtension, agentsExtension, jobsExtension, runtimeExtension]
function SharingDeviceSync() {
  useAccount(window.dovo.accountStorage, window.dovo.openExternalLink, useAppPreferences())
  return null
}
const captureThread = window.location.hash.startsWith('#thread-share=')
const threadHash = captureThread ? '#thread-share=' : '#thread='
const threadWindow = window.location.hash.startsWith(threadHash)
  ? decode(
      threadWindowTargetSchema,
      JSON.parse(decodeURIComponent(window.location.hash.slice(threadHash.length))),
    )
  : undefined
const browserWindowId = /^#browser-window=([a-f0-9-]{36})$/.exec(window.location.hash)?.[1]
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
        {window.dovo?.accountStorage && <SharingDeviceSync />}
        <Workbench
          extensions={extensions}
          threadWindow={threadWindow}
          captureContent={
            captureThread && threadWindow ? (
              <ThreadShare taskId={threadWindow.taskId} runtimeId={threadWindow.runtimeId} />
            ) : undefined
          }
          browserWindowId={browserWindowId}
          openBrowserWindow={window.dovo?.openBrowserWindow}
          onBrowserWorkspaceFocus={window.dovo?.onBrowserWorkspaceFocus}
          popOutThread={window.dovo?.popOutThread}
          appInfo={window.dovo?.appInfo}
          desktopPlatform={window.dovo?.platform}
          repositoryOpener={window.dovo?.repositoryOpener}
          pickDirectory={window.dovo?.pickDirectory}
          defaultBrowser={window.dovo?.defaultBrowser}
          browser={window.dovo?.browser}
          browserFrames={window.dovo?.browserFrames}
          browserExtensions={window.dovo?.browserExtensions}
          onBrowserContextAction={window.dovo?.onBrowserContextAction}
          onOpenLink={window.dovo?.onOpenLink}
          openBrowserLink={window.dovo?.openBrowserLink}
          accountStorage={window.dovo?.accountStorage}
          openExternalLink={window.dovo?.openExternalLink}
          inputPreview={threadWindow || browserWindowId ? undefined : window.dovo?.inputPreview}
          taskLauncher={threadWindow || browserWindowId ? undefined : window.dovo?.taskLauncher}
          updates={window.dovo?.updates}
          windowColors={window.dovo?.setWindowColors}
        />
      </WindowsRuntimeGate>
    )}
  </StrictMode>,
)
