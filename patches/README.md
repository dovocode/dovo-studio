# Dependency security backports

The lockfile keeps compatible upstream fixes for shell-quote (1.12.0), compression (1.8.2),
prosemirror-view (1.42.6) and KaTeX (0.18.2).

These packages currently have no published upstream fix for the listed advisory. pnpm applies the
checked-in patches on install; version-based `pnpm audit` still lists their original versions.

- **node-forge 1.4.0 — GHSA-86w9-cpqp-85rv:** reject extra elements inside the RSA PKCS#1 v1.5
  DigestAlgorithm sequence. Retain the valid OID with optional empty NULL representation. This
  changes validation only, using the library's existing RSA/ASN.1 implementation.
- **braces 3.0.3 — GHSA-vfj7-8cjw-p6xm:** bound both brace and parenthesis nesting to 256 parser
  levels before downstream recursive processing. Excessive patterns fail with `SyntaxError`.
- **sprintf-js 1.1.3 — GHSA-hp3w-g68c-fv3c:** clamp numeric `e`, `f`, `g` precision to ECMAScript's
  valid native formatter range (maximum 100; minimum 1 for `g`). Ordinary formatting is unchanged;
  excessive precision produces bounded output rather than a native range failure.

Run `node --test scripts/packaging/security-backports.test.mjs` for adversarial RSA signatures,
nested patterns and excessive numeric precision. Replace backports with compatible upstream fixes
when available, then rerun these regressions and the package checks. Do not suppress audit findings
without checking the applied patch and its fixture.

# Compatibility patches and version constraints

- **werift 0.25.1:** add an opt-in `setLocalDescription(description, { trickle: true })` path so
  answers start ICE checks while discovery continues. Keep checks alive for late local and remote
  candidates, pair late TURN allocations, finish exhausted checklists, and close transports that
  finish gathering after cancellation. Preserve all TURN URL transports and credentials through
  configuration updates and gather alternatives concurrently; Dovo bounds those allocations to four
  URLs covering UDP/TCP/TLS. The default still waits for complete gathering. Apply to CommonJS and
  bundled ESM entrypoints, including polyfills. Verify with `peer-ice-engine.test.ts`,
  `peer-connections.test.ts` and `pnpm test:peer-connection:browser`; set `DOVO_TEST_TURN_BINARY`
  for real UDP/TCP/TLS coturn coverage, including unavailable TLS and blocked UDP alternatives.
- **react-native-enriched-markdown 1.1.1:** retain streaming render coalescing, live accessibility
  geometry and query predicate evaluation. Verify with
  `node scripts/check-mobile-markdown-highlighting.mjs`.
- **react-native-webview 14.0.1:** its declaration defaults extra props to `undefined`, making
  `WebViewProps & P` resolve to `never`. Default to `unknown` so normal props and typed refs work.
  The workspace mobile typecheck exercises the consumers; runtime behavior is unchanged.
- **@mcp-ui/legacy:** keep the alias on client 5.17.3. Client 7 removed the legacy HTML/Remote DOM
  renderer; modern MCP apps already use `@modelcontextprotocol/ext-apps`. Verify both formats with
  `pnpm test:mcp-apps:browser`.
- **iOS scenes:** use Expo 58's `ExpoAppSceneDelegate` for native startup and lifecycle forwarding.
  Dovo's scene plugin only seeds the cold-start quick-action URL before React starts. Run
  `expo prebuild --no-install --platform ios` to verify generated projects.
- **Mobile React, AsyncStorage and gesture handler:** retain Expo 58's recommended versions (React
  19.3.0, AsyncStorage 2.2.0, gesture handler ~3.3.0); `expo install --check` validates the native
  dependency set. Desktop/web React can update independently.
- **ACP SDK 2:** use its `/unstable` v1 entrypoint consistently to retain negotiated subagents and
  session features. The local callback boundary derives its request types from the SDK handler maps;
  no legacy SDK implementation interface is required.

Expo 58 removes the dependency on decode-uri-component 0.2.2, so its security backport is retired.
The remaining version-based audit reports are covered by the security regressions above.

Vite Plus 1.2's forced task caching causes native compiler/esbuild subprocesses to fail with
`spawn EINVAL` on Node 26/Linux. Build and typecheck explicitly disable task caching while retaining
Vite Plus task ordering; restore caching after upstream supports these subprocesses.
