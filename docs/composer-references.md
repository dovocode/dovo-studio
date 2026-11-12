# Inline composer references

The input shows compact chips for file paths, skills, MCP servers and exact model references.
Desktop/web uses the existing rich editor. Native iOS and Android use a local Expo text input
module. The saved draft and sent message remain Markdown text. Chips add no new saved format and do
not change the selected model or runtime.

Chips show an icon and name, with no type prefix. File chips use the file tree's code, data, text,
image, config, terminal or generic file icon. Skills use a sparkles icon. MCP servers use a plug
icon. Model chips use the referenced harness icon. Custom agent references use that agent's harness.
Lookup uses the same built-in and scoped agents as the model picker. Desktop chips also refresh when
those settings arrive or change, without a draft edit. ACP installation references use the ACP icon.
Unknown or removed harnesses use a generic model icon. Native inputs use bundled images from the
same Lucide and harness icon data and keep brand colors or apply the current text color as
appropriate.

Use the existing mention menu to insert a reference. A completed file token such as `@src/app.ts `
becomes a file chip. Skill and MCP tokens must match available resource names. Model chips use the
existing encoded model reference. Model suggestions list each default harness once. Saved agents
keep their own entries. A scoped built-in agent also keeps its entry when its account or launch
settings differ from the default harness. Headings, code and links keep their normal text behavior.
A token still being typed stays editable until its trailing boundary arrives. Copy keeps the full
path or model reference, even when the displayed label is short. Backspace removes a whole chip.
Paste uses plain text on native inputs.

Desktop/web users can switch to Markdown source with the existing source toggle or `Ctrl+Shift+M`
(`⌘+Shift+M` on macOS). This keeps the source and caret. Desktop chips use ProseMirror inline atoms
over the original text and marks. Android keeps source text under replacement spans. iOS uses
attachments and translates between display and source offsets. Both native inputs leave IME
composition alone and reject stale JavaScript text updates. On iOS, Undo can first undo chip
formatting before it undoes the text. Attachments carry the input font and text color. Cursor moves
and deletions restore the typing style, including when the last chip is deleted before JavaScript
acknowledges the edit.

## Sent user messages

Sent user messages show the same file, skill, MCP server and model references. The final token is
complete even without trailing whitespace. Code examples and authored links keep their normal
rendering. Assistant messages do not turn mentions into chips. Resource lookup uses the thread's
scoped agents and settings.

Desktop uses the composer's chip styles and icons. Mobile uses the same native attachment/span
renderer as the composer in a read-only, selectable view. The message grows to fit its text. It does
not open the keyboard or add an inner scroll area. Native selection copy keeps the full source. The
message Copy action also uses the unchanged source. PR links still use the app's link chooser. Text
sizing follows Dynamic Type and car mode.

This mobile change needs a new native app build. The module reports support through
`supportsReferenceMessages`. Older installed modules keep literal, selectable message text and PR
links until the native update arrives. The stored message format does not change.

Run the sent-message checks from the repository root:

```sh
pnpm exec playwright install chromium
pnpm --filter @dovo/protocol build
pnpm test:rich-composer:browser
node scripts/check-native-composer-bridge-browser.mjs
node scripts/check-thread-pull-links-browser.mjs
node scripts/check-chat-files-browser.mjs
```

The browser checks cover labels, icons, scoped models, final tokens, code/link exclusions, wrapping,
source retention, file previews and PR actions. The native JavaScript test replaces the Expo/RN
event boundary. The UIKit harness and Android instrumentation tests exercise production native text
views. They cover read-only selection, source copy or source selection, keyboard suppression and
source offsets. The UIKit harness also checks link routing and scaled text. These checks do not
establish physical-device behavior, VoiceOver/TalkBack behavior or the complete Expo message list.

This change passed 16 parser/editor unit tests, the listed browser checks, four package type checks,
52 UIKit simulator checks, six Android emulator tests and real Expo module builds on both platforms.
The UIKit simulator also verified tap and long-press actions on the displayed PR link. Repository
checks report zero errors and 31 existing warnings. These results apply to this local change. They
are separate from the hosted checks for nightly `.829`.

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

Local validation passed the rich-composer browser fixture, native JavaScript adapter fixture, 42
UIKit simulator checks, five Android emulator instrumentation tests and the real Expo module builds
on both platforms. The JavaScript adapter fixture mocks the native event boundary.

The complete iOS Release app also built on Dominic's MacBook with the existing development signing
identity. Earlier builds installed over `com.dovo.studio` on Dominic's physical iPhone and launched
to the existing thread list. The later icon build installed, but the locked phone blocked its launch
check. These checks do not establish full composer behavior on physical hardware. Real hardware
keyboards, physical-device IMEs, accessibility tools and the full Expo event/render loop still need
an installed-app interaction pass. Do not ship solely on the isolated module tests.
