import { setTimeout as delay } from 'node:timers/promises'

async function fetchWithRetry(url, fallback) {
  for (let attempt = 1; ; attempt++) {
    const accept = url.includes('/releases/assets/') ? 'application/octet-stream' : '*/*'
    const token =
      new URL(url).origin === 'https://api.github.com'
        ? process.env.GH_TOKEN || process.env.GITHUB_TOKEN
        : undefined
    let response = await fetch(url, {
      headers: { Accept: accept, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      redirect: token ? 'manual' : 'follow',
      signal: AbortSignal.timeout(600_000),
    })
    const location = response.headers.get('location')
    if (token && [301, 302, 303, 307, 308].includes(response.status) && location) {
      await response.body?.cancel()
      response = await fetch(new URL(location, url).href, {
        headers: { Accept: accept },
        signal: AbortSignal.timeout(600_000),
      })
    }
    if (attempt === 3 || ![502, 503, 504].includes(response.status)) return response
    await response.body?.cancel()
    console.warn(`Release download returned HTTP ${response.status}; retrying (${attempt}/3)`)
    await delay(1000 * 2 ** (attempt - 1))
    if (attempt === 1 && fallback) url = await fallback()
  }
}

/** Use the public asset API when GitHub's download gateway fails. Callers verify the bytes. */
export function releaseDownloader(baseUrl) {
  const githubRelease = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)$/.exec(
    baseUrl,
  )
  const releaseApi = githubRelease
    ? `https://api.github.com/repos/${githubRelease[1]}/releases/tags/${githubRelease[2]}`
    : null
  let assets
  const fallbackUrl = async (name) => {
    if (!releaseApi) return `${baseUrl}/${name}`
    if (!assets) {
      const response = await fetchWithRetry(releaseApi)
      if (!response.ok) throw new Error(`Could not read release assets: HTTP ${response.status}`)
      const release = await response.json()
      if (!Array.isArray(release.assets)) throw new Error('Release has no asset list')
      assets = release.assets
    }
    const asset = assets.find((asset) => asset?.name === name)
    if (!Number.isSafeInteger(asset?.id) || asset.id <= 0)
      throw new Error(`Release is missing asset: ${name}`)
    return `https://api.github.com/repos/${githubRelease[1]}/releases/assets/${asset.id}`
  }
  return (name) => fetchWithRetry(`${baseUrl}/${name}`, () => fallbackUrl(name))
}
