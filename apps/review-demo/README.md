# Isolated review demo

This service provides fictional threads and files for store reviewers. It imports the shared wire
protocol, but no runtime, agent, terminal, filesystem or provider services. Pairing codes, device
tokens and review-page sessions are held in bounded memory and disappear on restart.

Set `DOVO_DEMO_ORIGIN` to the externally reachable HTTP or HTTPS origin and `DOVO_DEMO_PASSWORD` to
a dedicated random reviewer password of at least 24 characters. Never commit the password. The
review page requires that password before generating a short-lived, single-use pairing code.
Unimplemented app operations fail closed.

From the repository root, build with `pnpm --filter @dovo/review-demo... -r build`, run with
`pnpm --filter @dovo/review-demo start`, and test with
`pnpm exec vp test apps/review-demo/src/server.test.ts`. `compose.yaml` supports a local Docker
deployment on loopback port 8082; health is `GET /health`.

Dokploy uses `dovocode/dovo-studio`, branch `main`, and `apps/review-demo/compose.dokploy.yaml`.
Build with `compose up -d --build` and keep the existing domain targeting service `demo` on
port 8080. Private configuration lives outside the checkout in
`/etc/dokploy/secrets/dovo-review-demo/demo.env`. Preserve the existing origin and reviewer password
during migration. A deployment restarts the demo, so existing demo devices must pair again.
