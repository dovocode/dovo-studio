import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function verifyMacIconToolchain() {
  const output = execFileSync('xcrun', ['actool', '--version'], { encoding: 'utf8' })
  const version = output.match(/<key>short-bundle-version<\/key>\s*<string>([^<]+)<\/string>/)?.[1]
  if (!version || Number(version.split('.')[0]) < 26)
    throw new Error(
      `Native macOS icons require Xcode 26 or newer; selected actool is ${version ?? 'unknown'}. Set DEVELOPER_DIR to a supported Xcode installation.`,
    )
  console.log(`Native macOS icon toolchain: actool ${version}`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  verifyMacIconToolchain()
