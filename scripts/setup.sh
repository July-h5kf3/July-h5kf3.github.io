#!/usr/bin/env bash
# Idempotent local setup for the Lorn Hugo site.
# Installs Hugo Extended, Dart Sass and Go into ~/.local, then warms Hugo modules.
set -euo pipefail

# Dart Sass / Go versions match .github/workflows/deploy.yml. CI builds with
# Hugo "latest"; the Stack theme (v4.0.3) requires Hugo Extended >= 0.157.0, so
# we pin a recent release that satisfies that minimum.
HUGO_VERSION="${HUGO_VERSION:-0.165.0}"
DART_SASS_VERSION="${DART_SASS_VERSION:-1.97.1}"
GO_VERSION="${GO_VERSION:-1.25.5}"

LOCAL_DIR="${HOME}/.local"
BIN_DIR="${LOCAL_DIR}/bin"
mkdir -p "${BIN_DIR}"

case "$(uname -m)" in
  x86_64) HUGO_ARCH="linux-amd64"; SASS_ARCH="linux-x64";   GO_ARCH="linux-amd64" ;;
  aarch64|arm64) HUGO_ARCH="linux-arm64"; SASS_ARCH="linux-arm64"; GO_ARCH="linux-arm64" ;;
  *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

export PATH="${LOCAL_DIR}/go/bin:${BIN_DIR}:${PATH}"

# --- Go -------------------------------------------------------------------
if [ "$("${LOCAL_DIR}/go/bin/go" version 2>/dev/null | awk '{print $3}')" != "go${GO_VERSION}" ]; then
  echo "Installing Go ${GO_VERSION}..."
  tmp="$(mktemp -d)"
  curl -sSLf -o "${tmp}/go.tar.gz" "https://go.dev/dl/go${GO_VERSION}.${GO_ARCH}.tar.gz"
  rm -rf "${LOCAL_DIR}/go"
  tar -C "${LOCAL_DIR}" -xzf "${tmp}/go.tar.gz"
  rm -rf "${tmp}"
else
  echo "Go ${GO_VERSION} already installed."
fi

# --- Hugo Extended --------------------------------------------------------
if [ "$("${BIN_DIR}/hugo" version 2>/dev/null | grep -o "v${HUGO_VERSION}+extended" || true)" != "v${HUGO_VERSION}+extended" ]; then
  echo "Installing Hugo Extended ${HUGO_VERSION}..."
  tmp="$(mktemp -d)"
  curl -sSLf -o "${tmp}/hugo.tar.gz" \
    "https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_${HUGO_ARCH}.tar.gz"
  tar -C "${tmp}" -xzf "${tmp}/hugo.tar.gz" hugo
  install -m 0755 "${tmp}/hugo" "${BIN_DIR}/hugo"
  rm -rf "${tmp}"
else
  echo "Hugo Extended ${HUGO_VERSION} already installed."
fi

# --- Dart Sass ------------------------------------------------------------
if [ "$("${BIN_DIR}/sass" --version 2>/dev/null || true)" != "${DART_SASS_VERSION}" ]; then
  echo "Installing Dart Sass ${DART_SASS_VERSION}..."
  tmp="$(mktemp -d)"
  curl -sSLf -o "${tmp}/sass.tar.gz" \
    "https://github.com/sass/dart-sass/releases/download/${DART_SASS_VERSION}/dart-sass-${DART_SASS_VERSION}-${SASS_ARCH}.tar.gz"
  tar -C "${tmp}" -xzf "${tmp}/sass.tar.gz"
  rm -rf "${LOCAL_DIR}/dart-sass"
  mv "${tmp}/dart-sass" "${LOCAL_DIR}/dart-sass"
  ln -sf "${LOCAL_DIR}/dart-sass/sass" "${BIN_DIR}/sass"
  rm -rf "${tmp}"
else
  echo "Dart Sass ${DART_SASS_VERSION} already installed."
fi

echo "Tool versions:"
go version
hugo version
sass --version

# --- Warm Hugo modules and verify the build -------------------------------
export GOPATH="${LOCAL_DIR}/gopath"
export GOMODCACHE="${GOPATH}/pkg/mod"
cd "$(dirname "$0")/.."
echo "Building site to warm the Hugo module cache..."
hugo --gc --minify --cleanDestinationDir

echo "Setup complete."
