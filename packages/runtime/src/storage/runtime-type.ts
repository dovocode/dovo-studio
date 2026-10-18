import { readFileSync } from 'node:fs'
import { platform } from 'node:os'
import type { RuntimeIcon } from '@dovo/protocol'

/** Deployment metadata is stronger evidence than a missing display (also common over SSH). */
export function detectRuntimeType(
  distribution = process.env.DOVO_SERVER_DISTRIBUTION,
  os = platform(),
  chassis = () => readFileSync('/sys/class/dmi/id/chassis_type', 'utf8').trim(),
): RuntimeIcon {
  if (distribution === 'archive' || distribution === 'source') return 'server'
  if (os === 'linux') {
    try {
      // SMBIOS portable, laptop, notebook, sub-notebook, tablet, convertible and detachable.
      if ([8, 9, 10, 14, 30, 31, 32].includes(Number(chassis()))) return 'laptop'
    } catch {
      // Containers and non-DMI systems need not expose chassis metadata.
    }
  }
  return 'desktop'
}
