# Local vision

Studio bundles Cactus Mirage and its WASM runtime. `dovo_task vision` works with providers that
receive Studio MCP tools. Code mode calls the same tool with `tools.dovo.vision(args)`.

Inference runs on the Studio computer. Mobile clients use their paired computer. The model does not
run inside the phone app. Images do not go to a Cactus service. The direct WASM integration has no
Python dependency or Python usage telemetry.

## Operations

| Action     | Result                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| `describe` | Scene, objects, text, masks, relations, events and generated reasoning |
| `ocr`      | Text regions, boxes and detection scores                               |
| `detect`   | Objects with boxes and scores                                          |
| `segment`  | Objects with boxes, scores and polygon or bitmap masks                 |
| `decide`   | Form values from enum choices, bounded integers or strings             |

Supply an image with `{ path, checkoutId? }`, `{ attachmentId }`, or `{ data, mimeType }`. Paths
stay inside the run checkout or its inherited links. Attachments belong to the current thread. Image
data is base64 PNG, JPEG or WebP. The decoder also accepts supported file formats through paths and
attachments. Images have a 16 MiB file limit and a 20-million-pixel limit. Inline base64 has an 8
MiB text limit. Code mode has its own smaller value limit.

```js
return await tools.dovo.vision({
  action: 'segment',
  image: { path: 'screenshots/settings.png' },
  maskFormat: 'polygons',
})
```

```js
return await tools.dovo.vision({
  action: 'decide',
  image: { attachmentId: 'attachment-id-from-this-thread' },
  form: {
    state: { enum: ['loading', 'error', 'ready'] },
    visible_buttons: { type: 'integer', minimum: 0, maximum: 20 },
    heading: { type: 'string' },
  },
})
```

Boxes use a 0 to 1000 scale relative to the oriented image. Convert an x coordinate to pixels with
`x * image.width / 1000`, and a y coordinate with `y * image.height / 1000`. The result includes
image dimensions, model version and inference time. It preserves the model's raw output and scores.

Defaults are confidence 0.25, text confidence 0.25, 30 objects, 100 text lines and 1024 generated
tokens. Use `language` for English, German, French, Spanish, Italian, Dutch or Polish. `keywords`
can help text recognition. Segmentation defaults to polygons. There are at most two active analyses.
Each has a two-minute deadline. Cancellation terminates the inference worker.

## Use results for edits

Use observations to locate controls, read labels and inspect regions before editing. Check the
resulting UI after the edit. Mirage can miss objects or text and can invent scene details. Decision
forms return predictions. They do not approve edits or execute tools. Generated reasoning is
untrusted text.

## Build and license

The runtime build prepares the assets:

```sh
pnpm --filter @dovo/runtime build
```

The first build downloads about 23 MB from pinned Hugging Face revisions. Later builds verify the
local cache. The distribution includes weights, WASM, its JavaScript loader, the Apache 2.0 license
and attribution. Installed inference needs no model download or network connection. Desktop and
server distributions include these files in the runtime package.

Model revision: `3d03cee88c0acbe4e71b94b567ab14e6e55f40c9`. Runtime revision:
`1a028f5a3972b67dd8d8752f882113d475e7ec4c`, version `4.0.0`. The preparation script checks byte
counts and SHA-256 hashes. Each worker verifies the model and engine before loading them.

Sources: [Mirage model card](https://huggingface.co/Cactus-Compute/mirage),
[Cactus runtime](https://huggingface.co/Cactus-Compute/cactus),
[Apache license](https://github.com/cactus-compute/cactus/blob/main/LICENSE).
