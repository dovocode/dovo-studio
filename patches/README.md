# Dependency security backports

The lockfile keeps compatible upstream fixes for shell-quote (1.12.0), compression (1.8.2),
prosemirror-view (1.42.6) and KaTeX (0.18.2).

These packages currently have no published upstream fix for the listed advisory. pnpm applies the
checked-in patches on install; version-based `pnpm audit` still lists their original versions.

- **braces 3.0.3 — GHSA-vfj7-8cjw-p6xm:** bound both brace and parenthesis nesting to 256 parser
  levels before downstream recursive processing. Excessive patterns fail with `SyntaxError`.
- **sprintf-js 1.1.3 — GHSA-hp3w-g68c-fv3c:** clamp numeric `e`, `f`, `g` precision to ECMAScript's
  valid native formatter range (maximum 100; minimum 1 for `g`). Ordinary formatting is unchanged;
  excessive precision produces bounded output rather than a native range failure.

Node-forge now uses upstream 1.4.3. Its RSA validation and TLS fixes need no local patch.

Run `node --test scripts/packaging/security-backports.test.mjs` for adversarial RSA signatures,
nested patterns and excessive numeric precision. Replace backports with compatible upstream fixes
when available, then rerun these regressions and the package checks. Do not suppress audit findings
without checking the applied patch and its fixture.

# Compatibility patches and version constraints

- **@electron/osx-sign 1.3.3:** add opt-in bounded signing concurrency (Dovo uses four), retaining
  the upstream per-file signer and validation. Canonicalize and deduplicate framework symlink paths,
  finish each depth before parents, sign the root app last, and drain active tasks on failure before
  builder retries. The default remains sequential. Apply to CommonJS, ESM and their declarations.
  Verify with `node --test scripts/packaging/mac-parallel-signing.test.mjs`; macOS CI also signs and
  verifies a real nested fixture ad hoc. Replace this patch when upstream offers equivalent
  scheduling.
- **electron-chrome-extensions 4.10.0:** return the caller's tab from `tabs.getCurrent`, leaving
  popups and background workers without a tab. Let preferred-size events size action popups instead
  of resetting their viewport to 25 pixels after load; responsive extensions such as Proton Pass
  otherwise retain the collapsed dimensions. Apply to both CommonJS and ESM. Verify with
  `node apps/desktop/scripts/check-browser-extensions-native.mjs --proton`.
- **werift 0.27.0:** retain the opt-in `setLocalDescription(description, { trickle: true })` path so
  answers start ICE checks while discovery continues. Also retain one-time ICE failure completion
  when all pairs fail before end-of-candidates. Upstream now preserves multiple TURN transports,
  credentials, configuration updates and gathering cancellation. Those fixes no longer need a local
  patch. Verify both the local option and upstream behavior with `peer-ice-engine.test.ts`,
  `peer-connections.test.ts` and `pnpm test:peer-connection:browser`. Set `DOVO_TEST_TURN_BINARY`
  for real coturn UDP/TCP/TLS coverage.
- **react-native-enriched-markdown 1.2.0:** retain live accessibility geometry and query predicate
  evaluation. Upstream now coalesces streaming renders. The patch also blocks an apply callback if
  rendering becomes disabled while its work is pending. Verify with
  `node scripts/check-mobile-markdown-highlighting.mjs`.
- **node-pty 1.2.0-beta.18:** dispose the Windows ConPTY output worker on socket close, including an
  exit with no final data. This keeps the existing prerelease line needed by the runtime.
- **expo-modules-autolinking 58.1.0:** keep the bounded 30-second Apple module scan. Cold CI hosts
  can exceed the upstream five-second deadline.
- **react-native-webview 14.0.1:** its declaration defaults extra props to `undefined`, making
  `WebViewProps & P` resolve to `never`. Default to `unknown` so normal props and typed refs work.
  The workspace mobile typecheck exercises the consumers; runtime behavior is unchanged.
- **prosemirror-markdown 1.13.9:** import `Token` from Markdown-it 15's bundled types. The workspace
  override also upgrades its tokenizer. Verify with the rich composer unit and browser tests,
  including exact draft round trips.
- **iOS scenes:** use Expo 58's `ExpoAppSceneDelegate` for native startup and lifecycle forwarding.
  Dovo's scene plugin only seeds the cold-start quick-action URL before React starts. Run
  `expo prebuild --no-install --platform ios` to verify generated projects.
- **Mobile React, AsyncStorage and gesture handler:** use the latest stable packages with Expo 58.
  AsyncStorage 3's default export retains access to the existing legacy store. Verify a native
  simulator build when changing this set; Expo's version check reports differences from its tested
  baseline.
- **ACP SDK 2:** use its `/unstable` v1 entrypoint consistently to retain negotiated subagents and
  session features. The local callback boundary derives its request types from the SDK handler maps;
  no legacy SDK implementation interface is required.

Expo 58 removes the dependency on decode-uri-component 0.2.2, so its security backport is retired.
The remaining version-based audit reports are covered by the security regressions above.

Vite Plus 1.2's forced task caching causes native compiler/esbuild subprocesses to fail with
`spawn EINVAL` on Node 26/Linux. Build and typecheck explicitly disable task caching while retaining
Vite Plus task ordering; restore caching after upstream supports these subprocesses.
