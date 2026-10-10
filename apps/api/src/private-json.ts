import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
export function writePrivateJson(path: string, value: unknown) {
  mkdirSync(dirname(path), {
    recursive: true,
    mode: 0o700,
  })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
}
