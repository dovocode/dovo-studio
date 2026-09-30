FROM node:24-slim AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @dovo/notification-relay... -r build
RUN pnpm --filter @dovo/notification-relay deploy --prod /out

FROM node:24-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
