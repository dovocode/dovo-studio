import { cp, mkdir } from 'node:fs/promises'
const directory = new URL('../packages/runtime/dist/previews/ios-device/', import.meta.url)
await mkdir(directory, { recursive: true })
for (const name of ['Cargo.toml', 'Cargo.lock', 'src', 'LICENSE-idevice'])
  await cp(
    new URL(`../packages/runtime/native/ios-device/${name}`, import.meta.url),
    new URL(name, directory),
    { recursive: true },
  )
