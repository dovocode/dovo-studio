FROM node:26-slim AS build
WORKDIR /workspace
RUN npm install --global pnpm@12.18.0
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @dovo/review-demo... -r build

FROM node:26-slim
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/review-demo/dist/demo.cjs ./demo.cjs
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "demo.cjs"]
