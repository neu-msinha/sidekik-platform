#!/usr/bin/env bash
# Cut a release tag of @sidekik/contracts with a prebuilt dist/.
#
#   pnpm release 0.1.0          # creates annotated tag v0.1.0 locally
#   git push <remote> v0.1.0    # then publish it
#
# main never contains dist/. The tag points at a detached commit = HEAD + dist/,
# so consumers that pin "github:<org>/sidekik-platform#vX.Y.Z" get compiled JS
# without running any build step (pnpm 10 blocks build scripts in git deps).
set -euo pipefail

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "usage: pnpm release <semver>   e.g. pnpm release 0.1.0" >&2
  exit 2
fi
TAG="v$VERSION"

cd "$(dirname "${BASH_SOURCE[0]}")/.."
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "working tree has changes; commit or stash them first" >&2
  exit 1
fi
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "tag $TAG already exists" >&2
  exit 1
fi

pnpm typecheck
pnpm test
rm -rf dist
pnpm build

START="$(git rev-parse --abbrev-ref HEAD)"
[[ "$START" == "HEAD" ]] && START="$(git rev-parse HEAD)"
trap 'git checkout -q "$START"' EXIT

git checkout -q --detach
npm pkg set version="$VERSION"
git add -f dist package.json
git commit -q -m "chore(release): $TAG"
git tag -a "$TAG" -m "$TAG"

echo "Tagged $TAG at $(git rev-parse --short HEAD) (not on any branch)."
echo "Publish with: git push <remote> $TAG"
