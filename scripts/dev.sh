#!/usr/bin/env bash
set -euo pipefail
export PATH="${HOME}/.local/go/bin:${HOME}/.local/bin:${PATH}"
export GOPATH="${HOME}/.local/gopath"
export GOMODCACHE="${HOME}/.local/gopath/pkg/mod"
cd "$(dirname "$0")/.."
exec hugo server --bind 127.0.0.1 --port 1313
