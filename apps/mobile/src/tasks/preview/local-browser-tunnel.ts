export type LocalBrowserTunnel = { url: string; close: () => void }

export async function openLocalBrowserTunnel(
  _page: string,
  _ticket: () => Promise<string>,
  _signal: AbortSignal,
  _onError: (error: Error) => void,
): Promise<LocalBrowserTunnel> {
  throw new Error('Opening a localhost preview requires the mobile app.')
}
