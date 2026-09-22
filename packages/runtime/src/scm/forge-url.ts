// Reverse proxies may decode escaped slashes before routing; validate that interpretation too.
export function withinForgeServer(url: URL, base: URL) {
  try {
    const decoded = new URL(decodeURIComponent(url.pathname), url.origin)
    return (
      url.origin === base.origin &&
      decoded.origin === base.origin &&
      url.pathname.startsWith(base.pathname) &&
      decoded.pathname.startsWith(base.pathname) &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}
