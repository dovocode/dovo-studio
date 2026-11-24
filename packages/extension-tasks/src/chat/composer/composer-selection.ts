import { sameWorkspaceFields, type WorkspaceContextValue } from '@dovo/studio-core'

/** Composer controls do not consume streamed messages or other threads' metadata. */
export function selectComposerWorkspace(
  value: Pick<
    WorkspaceContextValue,
    | 'workspace'
    | 'snapshot'
    | 'setWorkspace'
    | 'request'
    | 'requestEffect'
    | 'connected'
    | 'connection'
    | 'flush'
    | 'activeRuntimeId'
  >,
) {
  const snapshot = value.snapshot
  return {
    workspace: { agents: value.workspace.agents, repositories: value.workspace.repositories },
    setWorkspace: value.setWorkspace,
    request: value.request,
    requestEffect: value.requestEffect,
    connected: value.connected,
    connection: value.connection,
    flush: value.flush,
    activeRuntimeId: value.activeRuntimeId,
    snapshot: snapshot
      ? {
          defaults: snapshot.defaults,
          botInvocationResourcesSupported: snapshot.botInvocationResourcesSupported,
          retryUsesCurrentFiles: snapshot.retryUsesCurrentFiles,
          questions: snapshot.questions,
          planModeSupported: snapshot.planModeSupported,
          fullTurnSettingsSupported: snapshot.fullTurnSettingsSupported,
          persistentTurnModelsSupported: snapshot.persistentTurnModelsSupported,
          permissionPolicySupported: snapshot.permissionPolicySupported,
          promptQueueStagingSupported: snapshot.promptQueueStagingSupported,
          directMessageSupported: snapshot.directMessageSupported,
          queuedTurnSettingsSupported: snapshot.queuedTurnSettingsSupported,
          queuePausePreservationSupported: snapshot.queuePausePreservationSupported,
          messageSetupSupported: snapshot.messageSetupSupported,
          messageDraftIdentitySupported: snapshot.messageDraftIdentitySupported,
          promptSuggestionsEnabled: snapshot.promptSuggestionsEnabled,
        }
      : null,
  }
}

export function sameComposerWorkspace(
  a: ReturnType<typeof selectComposerWorkspace>,
  b: ReturnType<typeof selectComposerWorkspace>,
) {
  return (
    sameWorkspaceFields(a.workspace, b.workspace) &&
    (a.snapshot === b.snapshot ||
      (!!a.snapshot && !!b.snapshot && sameWorkspaceFields(a.snapshot, b.snapshot))) &&
    sameWorkspaceFields(
      { ...a, workspace: null, snapshot: null },
      { ...b, workspace: null, snapshot: null },
    )
  )
}
