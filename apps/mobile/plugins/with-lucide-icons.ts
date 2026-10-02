import { withDangerousMod, type ConfigPlugin } from 'expo/config-plugins'
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Template images keep native SwiftUI controls tintable without replacing them with JS views. */
const withLucideIcons: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'ios',
    async (mod) => {
      const source = join(mod.modRequest.projectRoot, 'assets/icons')
      const catalog = join(
        mod.modRequest.platformProjectRoot,
        mod.modRequest.projectName ?? 'DovoStudio',
        'Images.xcassets',
      )
      for (const file of await readdir(source)) {
        if (!file.endsWith('@3x.png')) continue
        const name = file.replace('@3x.png', '')
        const target = join(catalog, `dovo-${name}.imageset`)
        await mkdir(target, { recursive: true })
        await copyFile(join(source, file), join(target, file))
        await writeFile(
          join(target, 'Contents.json'),
          JSON.stringify({
            images: [{ filename: file, idiom: 'universal', scale: '3x' }],
            info: { author: 'xcode', version: 1 },
            properties: { 'template-rendering-intent': 'template' },
          }),
        )
      }
      return mod
    },
  ])
export default withLucideIcons
