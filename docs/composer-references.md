# Inline composer references

The input shows compact chips for file paths, skills, MCP servers and exact model references.
Desktop/web uses the existing rich editor. Native iOS and Android use a local Expo text input
module. The saved draft and sent message remain Markdown text. Chips add no new saved format and do
not change the selected model or runtime.

Chips show an icon and name, with no type prefix. File chips use the file tree's code, data, text,
image, config, terminal or generic file icon. Skills use a sparkles icon. MCP servers use a plug
icon. Model chips use the referenced harness icon. Custom agent references use that agent's harness.
ACP installation references use the ACP icon. Unknown or removed harnesses use a generic model icon.
Native inputs use bundled images from the same Lucide and harness icon data and keep brand colors or
apply the current text color as appropriate.

Use the existing mention menu to insert a reference. A completed file token such as `@src/app.ts `
becomes a file chip. Skill and MCP tokens must match available resource names. Model chips use the
existing encoded model reference. Headings, code and links keep their normal text behavior. A token
still being typed stays editable until its trailing boundary arrives. Copy keeps the full path or
model reference, even when the displayed label is short. Backspace removes a whole chip. Paste uses
plain text on native inputs.

Desktop/web users can switch to Markdown source with the existing source toggle or `Ctrl+Shift+M`
(`⌘+Shift+M` on macOS). This keeps the source and caret. Desktop chips use ProseMirror inline atoms
over the original text and marks. Android keeps source text under replacement spans. iOS uses
attachments and translates between display and source offsets. Both native inputs leave IME
composition alone and reject stale JavaScript text updates. On iOS, Undo can first undo chip
formatting before it undoes the text.

## Build

No new JavaScript dependency is required. Native users need a new app build. A JavaScript update
alone cannot add this module. Older installed apps keep the existing native text input.

Use the existing mobile build flow on the target build host:

```sh
pnpm install --frozen-lockfile
pnpm --filter @dovo/mobile exec expo run:ios
# Or, on an Android build host:
pnpm --filter @dovo/mobile exec expo run:android
```

Expo autolinks `apps/mobile/modules/dovo-composer-input`. Generated iOS and Android projects remain
build outputs. HTTP runtime addresses, pairing and tokens retain their current behavior.

## Verify

From the repository root:

```sh
pnpm exec playwright install chromium
pnpm exec vp test packages/protocol/src/conversation/presentation/composer-references.test.ts packages/extension-tasks/src/chat/composer/rich-markdown.test.ts
pnpm test:rich-composer:browser
pnpm test:mobile-composer:browser
pnpm --filter @dovo/protocol typecheck
pnpm --filter @dovo/extension-tasks typecheck
pnpm --filter @dovo/mobile typecheck
```

On a prepared macOS simulator build host, build the isolated UIKit harness:

```sh
node scripts/build-composer-references-ios-harness.mjs
```

Install the printed `.app` through Device Hub, then launch `com.dovo.composer-reference-qa`. Read
`Documents/composer-results.json` from its simulator data container. The harness runs production
UIKit view logic. It replaces only the Expo bridge and superclass with test stubs. Compile the real
Expo pod separately to check its native API integration:

```sh
cd apps/mobile/ios
xcodebuild -project Pods/Pods.xcodeproj -target DovoComposerInput -configuration Debug -sdk iphonesimulator ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO build
```

With the authorized Android test emulator running:

```sh
cd apps/mobile/android
./gradlew :dovo-composer-input:connectedDebugAndroidTest --max-workers=3
```

The Android instrumentation tests exercise the production EditText and InputConnection. They cover
UTF-16 positions, whole-chip hardware/software deletion and IME composition. The desktop browser
fixture checks source preservation, clipboard source, deletion, undo and source-mode changes.

Local validation passed the rich-composer browser fixture, native JavaScript adapter fixture, 23
UIKit simulator checks, five Android emulator instrumentation tests and the real Expo module builds
on both platforms. The JavaScript adapter fixture mocks the native event boundary.

The complete iOS Release app also built on Dominic's MacBook with the existing development signing
identity. It installed over `com.dovo.studio` on Dominic's physical iPhone and launched to the
existing thread list. This checks build, signing, install and startup. It does not establish full
composer behavior on physical hardware. Real hardware keyboards, physical-device IMEs, accessibility
tools and the full Expo event/render loop still need an installed-app interaction pass. Do not ship
solely on the isolated module tests.
