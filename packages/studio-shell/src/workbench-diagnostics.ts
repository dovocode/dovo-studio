import type { ClientDiagnosticContext } from '@dovo/protocol'
import type { StudioHostApi } from '@dovo/studio-core'

export function workbenchDiagnosticContext(
  appInfo: StudioHostApi['appInfo'],
  browserPlatform: string | undefined,
): ClientDiagnosticContext {
  return {
    appVersion: appInfo?.version,
    channel: appInfo?.channel,
    ...(appInfo?.viewer
      ? {
          viewerPlatform: appInfo.viewer.platform,
          viewerArchitecture: appInfo.viewer.architecture,
          viewerProcessArchitecture: appInfo.viewer.processArchitecture,
        }
      : { browserPlatformLegacy: browserPlatform }),
  }
}
