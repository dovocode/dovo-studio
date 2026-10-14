import { ModelCatalogCache } from '@dovo/client-runtime'
import {
  decodeResult,
  modelCatalogPresentation,
  modelCatalogSchema,
  type ModelCatalog,
} from '@dovo/protocol'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { readWorkspaceDocument, writeWorkspaceDocument } from './read-cache'

/** IndexedDB and pure SHA256 work on paired HTTP LAN/VPN clients too. */
export function browserModelCatalogCache() {
  return new ModelCatalogCache<ModelCatalog>({
    storage: { getItem: readWorkspaceDocument, setItem: writeWorkspaceDocument },
    hash: async (value) => bytesToHex(sha256(utf8ToBytes(value))),
    decode: (value) => {
      const result = decodeResult(modelCatalogSchema, value)
      return result.success ? result.data : null
    },
    presentation: modelCatalogPresentation,
  })
}
