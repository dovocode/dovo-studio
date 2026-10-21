FROM node:24-slim AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @dovo/protocol build
RUN pnpm exec esbuild apps/review-demo/src/main.ts --bundle --platform=node --format=esm --target=node24 --minify --outfile=/out/demo.mjs

FROM node:24-slim
WORKDIR /app
COPY --from=build --chown=node:node /out/demo.mjs ./demo.mjs
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "demo.mjs"]
