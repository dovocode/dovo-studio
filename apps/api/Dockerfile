# syntax=docker/dockerfile:1
# Standalone Dovo runtime from the Linux server release archive. The image runs the same tested
# archive as the release, rather than a second build of the source.
# Build from the repository root after placing Dovo-Server-*-linux-<x64|arm64>.tar.gz in release/
# (pnpm package:server, or gh release download). See docs/server-setup.md#docker.

# Extraction needs only tar, so it runs natively even for cross-architecture builds.
FROM --platform=$BUILDPLATFORM node:26.13.1-trixie-slim AS archive
ARG TARGETARCH
RUN --mount=type=bind,source=release,target=/release <<'EOF'
set -eu
case "$TARGETARCH" in
  amd64) arch=x64 ;;
  arm64) arch=arm64 ;;
  *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;;
esac
set -- /release/Dovo-Server-*-linux-"$arch".tar.gz
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Expected exactly one Linux $arch server archive in release/. Found: $*" >&2
  exit 1
fi
mkdir /opt/dovo-server
tar -xzf "$1" -C /opt/dovo-server --no-same-owner
EOF

FROM node:26.13.1-trixie-slim
LABEL org.opencontainers.image.title="Dovo Server" \
      org.opencontainers.image.description="Standalone Dovo Studio runtime" \
      org.opencontainers.image.source="https://github.com/dovocode/dovo-studio"
# Agents work on Git repositories over HTTPS and SSH. The runtime uses ps to stop terminal and
# agent process trees. tini reaps orphaned agent processes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git openssh-client procps tini \
 && rm -rf /var/lib/apt/lists/*
COPY --from=archive /opt/dovo-server /opt/dovo-server
COPY --chmod=755 apps/api/docker-start.sh /usr/local/bin/dovo-runtime
# Nightly archives name their launcher dovo-server-nightly. Use one command name in the container.
RUN ln -s /opt/dovo-server/bin/dovo-server* /usr/local/bin/dovo-server \
 && mkdir -p /home/node/.dovo /home/node/.local/bin /projects \
 && chown node:node /home/node/.dovo /home/node/.local /home/node/.local/bin /projects \
 && chmod 700 /home/node/.dovo
# The home directory holds runtime data (~/.dovo), agent logins, Git settings and SSH keys.
# npm install -g as the node user writes to ~/.local, so added agent CLIs persist with the volume.
ENV DOVO_SERVER_DISTRIBUTION=archive \
    DOVO_HOST=0.0.0.0 \
    PORT=51464 \
    NPM_CONFIG_PREFIX=/home/node/.local \
    PATH=/home/node/.local/bin:$PATH
USER node
WORKDIR /home/node
EXPOSE 51464
# /health is unauthenticated and contains no workspace data.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --start-interval=2s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["dovo-runtime"]
