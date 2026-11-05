import { useState } from 'react'
import { useWorkspace } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { CommandPalette } from '../../../packages/studio-shell/src/command-palette'
import { WorkForm } from '../../../packages/extension-scm/src/work/work-form'
import { ProjectDeletion } from '../../../packages/extension-scm/src/connections/project-deletion'
import { ForgeConnectionsButton } from '../../../packages/extension-scm/src/connections/forge-connections'
import { ImportCodexSession } from '../../../packages/extension-scm/src/connections/import-codex-session'
import { ImportPiSession } from '../../../packages/extension-scm/src/connections/import-pi-session'
import { BrowserDownloadsPanel } from '../../../packages/extension-tasks/src/browser/browser-downloads-panel'
import { ArtifactLibraryActions } from '../../../packages/extension-tasks/src/chat/artifact-library-actions'
import { AgentEditor } from '../../../packages/extension-agents/src/agent-editor'
import { PullAskAgent } from '../../../packages/extension-scm/src/pulls/detail/ask-agent'
import { screenIssue, screenPull } from './desktop-screens-data'
import { useImageEditor } from '../../../packages/extension-tasks/src/chat/composer/image-editor'
import { TerminalCloseDialog } from '../../../packages/extension-tasks/src/terminal/terminal-close-dialog'
import { ComposerCommandDialog } from '../../../packages/extension-tasks/src/chat/composer/composer-command-dialog'
import { HarnessDialog } from '../../../packages/extension-tasks/src/dialogs/harness-dialog'
import { TaskPullLinkDialog } from '../../../packages/extension-tasks/src/dialogs/task-pull-link-dialog'
import { RepositoryDialog } from '../../../packages/extension-scm/src/connections/repository-dialog'
import { SourcePicker } from '../../../packages/extension-scm/src/connections/source-picker'
import { ProjectTransferDialog } from '../../../packages/extension-scm/src/connections/project-transfer'
import { JiraSourcesDialog } from '../../../packages/extension-scm/src/connections/jira-binding'
import { ArtifactExportEditor } from '../../../packages/extension-tasks/src/chat/artifact-export-editor'
import { WebsiteCustomizationEditor } from '../../../packages/extension-tasks/src/browser/website-customization-editor'
import { ThreadContextPicker } from '../../../packages/extension-tasks/src/chat/composer/thread-context-picker'
import { DraftStash } from '../../../packages/extension-tasks/src/chat/composer/draft-stash'
import { SectionOrderDialog } from '../../../packages/extension-tasks/src/list/section-order-dialog'
import { LocalCommitPicker } from '../../../packages/extension-tasks/src/review/local-commit-picker'
import { MessageAttachments } from '../../../packages/extension-tasks/src/chat/composer/message-attachments'
import { BrowserLibrary } from '../../../packages/extension-tasks/src/browser/browser-library'
import sampleImage from './assets/ui-polish-image.png'

const noop = () => {}
const noWrite = async (): Promise<never> => {
  throw new Error('Preview is read only.')
}

// Production dialogs rendered under the same synthetic workspace as DesktopScreen.
// Triggered flows stay in the capture script; this catalog handles state-owned follow-ups.
export function DesktopFollowUp({ name }: { name: string | null }) {
  const { workspace, runtimeRegistry } = useWorkspace()
  const [open, setOpen] = useState(true)
  const [undoRefreshed, setUndoRefreshed] = useState(false)
  const task = workspace.tasks[0]
  const repository = workspace.repositories.find((entry) => entry.id === task?.repositoryId)
  const close = () => setOpen(false)
  if (!open || !task || !repository) return null
  switch (name) {
    case 'command-palette':
      return (
        <CommandPalette
          open
          onOpenChange={close}
          commands={[
            { id: 'tasks', title: 'Go to threads', run: noop },
            { id: 'browser', title: 'Open browser workspace', run: noop },
            { id: 'settings', title: 'Open settings', run: noop },
          ]}
        />
      )
    case 'project-delete':
      return <ProjectDeletion repository={repository} />
    case 'forge-connections':
      return <ForgeConnectionsButton repositoryId={repository.id} />
    case 'import-codex':
      return <ImportCodexSession repositoryId={repository.id} />
    case 'import-pi':
      return <ImportPiSession repositoryId={repository.id} />
    case 'downloads':
      return <BrowserDownloadsPanel profileId="default" tabKey="preview-browser" />
    case 'issue-create':
    case 'issue-edit':
    case 'issue-comment':
    case 'pipeline-run':
      return (
        <WorkForm
          kind={
            name === 'issue-create'
              ? 'create'
              : name === 'issue-edit'
                ? 'edit'
                : name === 'pipeline-run'
                  ? 'run'
                  : 'comment'
          }
          repositoryId={repository.id}
          issue={name === 'issue-create' || name === 'pipeline-run' ? undefined : screenIssue.issue}
          options={{
            provider: 'github',
            issues: true,
            pipelines: true,
            pipelineActions: [],
            issueTypes: [],
            issueStates: [],
            assignees: false,
            labels: false,
          }}
          onClose={close}
          onDone={noop}
        />
      )
    case 'artifact-actions':
      return runtimeRegistry.profiles[0] ? (
        <ArtifactLibraryActions
          profile={runtimeRegistry.profiles[0]}
          artifact={{
            id: 'dd32a47b-19d1-4bc3-97cd-81b9c8ba4faa',
            taskId: task.id,
            title: 'Workspace notes',
            format: 'html',
            revision: 1,
            createdAt: '2026-10-21T10:00:00Z',
            updatedAt: '2026-10-21T10:00:00Z',
          }}
          onDeleted={noop}
        />
      ) : null

    case 'pr-ask-agent':
      return <PullAskAgent repositoryId={repository.id} detail={screenPull} onClose={close} />
    case 'add-agent':
    case 'edit-agent':
      return workspace.agents[0] ? (
        <AgentEditor
          initial={workspace.agents[0]}
          creating={name === 'add-agent'}
          computerName="Preview computer"
          onSave={noWrite}
          onClose={close}
        />
      ) : null
    case 'image-editor':
      return <ImageEditorPreview />
    case 'image-preview':
      return (
        <MessageAttachments
          taskId={task.id}
          files={[
            {
              id: 'e173b499-5caf-45ab-884c-355ee729af43',
              name: 'workspace.png',
              mime: 'image/png',
              size: 12400,
            },
          ]}
          previews={new Map([['e173b499-5caf-45ab-884c-355ee729af43', sampleImage]])}
        />
      )
    case 'terminal-close':
    case 'terminal-close-multiple':
      return (
        <TerminalCloseDialog
          labels={name.endsWith('multiple') ? ['Project shell', 'Dev server'] : ['Project shell']}
          onCancel={close}
          onConfirm={noWrite}
          onRestoreFocus={noop}
        />
      )
    case 'undo':
    case 'new-session':
    case 'undo-error':
      return (
        <ComposerCommandDialog
          command={name === 'new-session' ? 'new-session' : 'undo'}
          commandBusy={false}
          refreshing={false}
          needsRefresh={name === 'undo-error' && !undoRefreshed}
          canUndo
          connected
          running={false}
          error={
            name === 'undo-error' && !undoRefreshed
              ? 'The checkout changed since this turn. Refresh before trying again.'
              : ''
          }
          onClose={close}
          onConfirm={noWrite}
          onRefresh={() => setUndoRefreshed(true)}
        />
      )
    case 'harness':
      return <HarnessDialog task={task} onClose={close} />
    case 'link-pr':
      return <TaskPullLinkDialog task={task} onClose={close} />
    case 'repository-local':
    case 'repository-github':
    case 'repository-forge':
      return (
        <RepositoryDialog
          projectLabels
          initialSource={
            name === 'repository-local'
              ? 'local'
              : name === 'repository-github'
                ? 'github'
                : 'forge'
          }
          onClose={close}
        />
      )
    case 'source-picker':
      return (
        <SourcePicker
          title="Choose a project"
          sources={[
            {
              key: 'local',
              runtimeId: 'preview',
              runtimeName: 'Preview computer',
              name: repository.name,
              connected: true,
            },
            {
              key: 'offline',
              runtimeId: 'offline',
              runtimeName: 'Build computer',
              name: 'API service',
              connected: false,
            },
          ]}
          onClose={close}
          onSelect={noop}
        />
      )
    case 'project-transfer':
      return <ProjectTransferDialog repository={repository} sourceTask={task} onClose={close} />
    case 'jira-sources':
      return <JiraSourcesDialog onClose={close} />
    case 'artifact-export':
      return (
        <ArtifactExportEditor
          content="<!doctype html><html><head><style>body{font:16px system-ui;color:#252832;background:#fff;padding:48px;max-width:760px;margin:auto}h1{font-size:32px}p{line-height:1.7;color:#555b66}section{border:1px solid #ddd;border-radius:12px;padding:24px;margin-top:24px}</style></head><body><h1>Workspace notes</h1><p>A sample export copy. Select text to refine it or exclude a section before exporting.</p><section><h2>Navigation review</h2><p>Keep the project context visible and give the conversation room to breathe.</p></section></body></html>"
          onAction={close}
        />
      )
    case 'website-customization':
      return (
        <WebsiteCustomizationEditor
          website={{
            origin: 'https://example.com',
            enabled: true,
            css: 'main {\n  max-width: 72rem;\n  margin-inline: auto;\n}',
            script: '',
          }}
          profileName="Default"
          onSave={noWrite}
          onAgent={noop}
          onClose={close}
        />
      )
    case 'thread-context':
      return (
        <ThreadContextPicker taskId="another-thread" disabled={false} upload={noWrite} showLabel />
      )
    case 'draft-stash':
      return (
        <DraftStash
          scope="ui-polish"
          getText={() => ''}
          onChange={noop}
          focus={noop}
          hasAttachments={false}
        />
      )
    case 'section-order':
      return <SectionOrderDialog />
    case 'local-commits':
      return <LocalCommitPicker taskId={task.id} onSelect={noop} />
    case 'browser-history':
    case 'browser-bookmarks':
      return (
        <BrowserLibrary
          view={name === 'browser-history' ? 'history' : 'bookmarks'}
          bookmarks={[]}
          visits={[]}
          closed={[]}
          onClose={close}
          onOpen={noop}
          onRemoveBookmark={noop}
          onClearHistory={noop}
          onReopen={noop}
        />
      )
    default:
      return null
  }
}

function ImageEditorPreview() {
  const imageEditor = useImageEditor()
  return (
    <>
      <Button
        onClick={() => {
          void fetch(sampleImage)
            .then((response) => response.blob())
            .then((blob) =>
              imageEditor.edit(new File([blob], 'workspace.png', { type: 'image/png' })),
            )
        }}
      >
        Edit sample image
      </Button>
      {imageEditor.editor}
    </>
  )
}
