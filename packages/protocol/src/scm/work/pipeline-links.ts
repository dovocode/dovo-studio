import { gitRemoteIdentity } from '../../runtime/connection/project-machines.js'

/** Run and job permalinks open the same pipeline while retaining the original URL. */
export function githubPipelineTarget(input: string) {
  try {
    const url = new URL(input)
    const match = url.pathname.match(
      /^\/([^/]+)\/([^/]+)\/actions\/runs\/([1-9]\d*)(?:\/job\/[1-9]\d*)?\/?$/,
    )
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.hostname !== 'github.com' ||
      url.port ||
      url.username ||
      url.password ||
      !match
    )
      return null
    return {
      id: match[3],
      identity: gitRemoteIdentity(`${url.origin}/${match[1]}/${match[2]}`),
      url: url.href,
    }
  } catch {
    return null
  }
}
