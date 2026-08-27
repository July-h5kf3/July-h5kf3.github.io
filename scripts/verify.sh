#!/usr/bin/env bash
set -euo pipefail

export PATH="${HOME}/.local/go/bin:${HOME}/.local/bin:${PATH}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v hugo >/dev/null; then
  echo "hugo not found" >&2
  exit 1
fi

hugo --minify --gc --cleanDestinationDir

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

[ -f public/index.html ] || fail "missing public/index.html"
[ -f public/about/index.html ] || fail "missing /about"
[ -f public/archives/index.html ] || fail "missing /archives"
[ -f public/search/index.html ] || fail "missing /search"
[ -f public/p/hessian-series/index.html ] || fail "missing /p/hessian-series"
[ -f public/p/transformer-positional-encoding/index.html ] || fail "missing /p/transformer-positional-encoding"
[ -f public/p/triton/index.html ] || fail "missing /p/triton"
[ -f public/p/low-precision-floats/index.html ] || fail "missing /p/low-precision-floats"

grep -q ">Lorn<" public/index.html || fail "homepage title is not Lorn"
grep -q "个人笔记" public/index.html || fail "sidebar subtitle missing"
grep -q "article-title" public/index.html || fail "homepage renders no post cards"
grep -q "Hessian" public/p/hessian-series/index.html || fail "hessian article body missing"
grep -q "RoPE" public/p/transformer-positional-encoding/index.html || fail "rope article body missing"
grep -q "Triton" public/p/triton/index.html || fail "triton article body missing"
grep -q "IEEE 754" public/p/low-precision-floats/index.html || fail "fp article body missing"

if grep -q "Markdown Syntax Guide" public/index.html; then
  fail "starter sample post still on homepage"
fi
if grep -q "disqus" public/index.html; then
  fail "Disqus snippet still present"
fi
if grep -q "hugo-theme-stack-starter" public/index.html; then
  fail "starter site title still present"
fi

echo "OK: site checks passed"
