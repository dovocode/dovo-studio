FROM node:26-slim AS build
WORKDIR /workspace
RUN npm install --global pnpm@12.18.0
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @dovo/design-system... -r build

FROM nginxinc/nginx-unprivileged:1.31-alpine
COPY apps/design-system/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /workspace/apps/design-system/storybook-static /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
