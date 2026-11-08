import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import type { XcodeProject } from 'expo/config-plugins'
import { expect, test } from 'vite-plus/test'
import { separateExtensionPlists } from './with-share-extension'

test('share and widget plists stay separate through repeated project generation', () => {
  const require = createRequire(import.meta.url)
  const xcode: { project(path: string): XcodeProject } = createRequire(
    require.resolve('expo/config-plugins'),
  )('xcode')
  const directory = mkdtempSync(join(tmpdir(), 'dovo-extension-plists-'))
  try {
    const path = join(directory, 'project.pbxproj')
    writeFileSync(
      path,
      `{
      archiveVersion = 1;
      objectVersion = 56;
      objects = {
        /* Begin PBXBuildFile section */
        CCCCCCCCCCCCCCCCCCCCCCCC = {isa = PBXBuildFile; fileRef = AAAAAAAAAAAAAAAAAAAAAAAA;};
        /* End PBXBuildFile section */
        /* Begin PBXFileReference section */
        AAAAAAAAAAAAAAAAAAAAAAAA = {isa = PBXFileReference; path = App.swift; sourceTree = "<group>";};
        /* End PBXFileReference section */
        /* Begin PBXGroup section */
        BBBBBBBBBBBBBBBBBBBBBBBB = {isa = PBXGroup; children = (); sourceTree = "<group>";};
        /* End PBXGroup section */
      };
      rootObject = BBBBBBBBBBBBBBBBBBBBBBBB;
    }\n`,
    )
    const project = xcode.project(path)
    project.parseSync()
    const share = project.addPbxGroup(
      ['Info.plist'],
      'expo-sharing-extension',
      'expo-sharing-extension',
    )
    const widget = project.addPbxGroup(['Info.plist'], 'ExpoWidgetsTarget', 'ExpoWidgetsTarget')
    expect(share.pbxGroup.children[0]?.value).toBe(widget.pbxGroup.children[0]?.value)
    separateExtensionPlists(project)
    expect(share.pbxGroup.children[0]?.value).not.toBe(widget.pbxGroup.children[0]?.value)
    for (const group of [share.pbxGroup, widget.pbxGroup]) {
      const reference = project.pbxFileReferenceSection()[group.children[0]!.value]
      expect(reference).toMatchObject({ path: '"Info.plist"', sourceTree: '"<group>"' })
    }
    const fixed = project.writeSync()
    writeFileSync(path, fixed)
    project.parseSync()
    separateExtensionPlists(project)
    expect(project.writeSync()).toBe(fixed)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
