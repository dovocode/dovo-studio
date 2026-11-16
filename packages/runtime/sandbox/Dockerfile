# Dovo thread sandbox image. Dovo builds it locally on first use and tags it with a hash of
# this directory and the build arguments. Changing any file here builds a new image.
# Harness CLIs and project tools are not part of the image. Dovo installs them with mise into
# the shared `dovo-sandbox-mise` volume when a thread first needs them.
FROM debian:stable-slim@sha256:fbfb4059d2127120aa05b6e6064523d2102552f0cf0026ddf0701c12f1f8f3e0

ARG TARGETARCH
ARG HOST_UID=1000
ARG HOST_GID=1000
ARG MISE_VERSION=2026.11.9
ARG MISE_SHA256_AMD64=f13f3e5ec88807e0161669b3aa07a91d84478cdf1e95b5b92b63f85a25d42395
ARG MISE_SHA256_ARM64=b8dd05af6447cee933928664982a8cb2fa646e6951cfc8539db23ce2554a7b04
ARG YQ_VERSION=4.54.3
ARG YQ_SHA256_AMD64=129534601871538efe0ba4c5e62a34fb1d5f469bcb975c4fddeb467d82974973
ARG YQ_SHA256_ARM64=89f69310b61b68d1245065a1241d1fc843f7a36cd6103ffd77ad987613bd1b67

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash git git-lfs openssh-client ca-certificates curl wget gnupg \
      ripgrep fd-find jq \
      tar gzip xz-utils zip unzip zstd \
      file less patch diffutils procps findutils tree \
      build-essential pkg-config libssl-dev \
      locales tzdata tini bzip2 socat \
 && ln -s /usr/bin/fdfind /usr/local/bin/fd \
 && install -d -m 0755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod 0644 /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
    arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "$arch" in \
      amd64) mise_arch=x64; mise_sum="$MISE_SHA256_AMD64"; yq_sum="$YQ_SHA256_AMD64" ;; \
      arm64) mise_arch=arm64; mise_sum="$MISE_SHA256_ARM64"; yq_sum="$YQ_SHA256_ARM64" ;; \
      *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /usr/local/bin/mise \
      "https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/mise-v${MISE_VERSION}-linux-${mise_arch}"; \
    echo "${mise_sum}  /usr/local/bin/mise" | sha256sum -c -; \
    curl -fsSL -o /usr/local/bin/yq \
      "https://github.com/mikefarah/yq/releases/download/v${YQ_VERSION}/yq_linux_${arch}"; \
    echo "${yq_sum}  /usr/local/bin/yq" | sha256sum -c -; \
    chmod 0755 /usr/local/bin/mise /usr/local/bin/yq

# A user with the host's uid and gid keeps bind-mounted files owned by the host user.
RUN set -eu; \
    if [ "$HOST_UID" != 0 ]; then \
      if ! getent group "$HOST_GID" >/dev/null; then groupadd -g "$HOST_GID" dovo; fi; \
      if ! getent passwd "$HOST_UID" >/dev/null; then \
        useradd -m -u "$HOST_UID" -g "$HOST_GID" -s /bin/bash dovo; \
      fi; \
    fi; \
    install -d -o "$HOST_UID" -g "$HOST_GID" /mise /mise/data /mise/cache /opt/dovo/harness

COPY mise.toml /etc/mise/config.toml
COPY bin/ /opt/dovo/bin/
RUN chmod 0755 /opt/dovo/bin/*

ENV MISE_DATA_DIR=/mise/data \
    MISE_CACHE_DIR=/mise/cache \
    MISE_YES=1 \
    MISE_PIPX_UVX=1 \
    PATH=/mise/data/shims:/opt/dovo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/dovo/harness

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
