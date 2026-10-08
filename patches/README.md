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
- **decode-uri-component 0.2.2 — GHSA-vcc3-ghjq-m6fr:** the existing patch backports upstream
  0.5.0's malformed percent/UTF-8 parser while preserving the CommonJS and plus-decoding API.

Run `node --test scripts/packaging/security-backports.test.mjs` for adversarial RSA signatures,
nested patterns and excessive numeric precision. Replace backports with compatible upstream fixes
when available, then rerun these regressions and the package checks. Do not suppress audit findings
without checking the applied patch and its fixture.
