#!/usr/bin/env bash
#
# Build the Sui coin registry and publish it to Hetzner Object Storage.
#
# This is the INTERIM publish path. Publishing is currently done manually /
# locally by a maintainer — CI validates and builds on every merge but does NOT
# auto-push (see .github/workflows/deploy.yml for the rationale). The long-term
# plan is a Temporal-orchestrated publish job; this script is the stopgap.
#
# The GitHub Actions deploy workflow calls this same script, so the local and
# CI publish logic never drift.
#
# Usage:
#   scripts/push.sh --dry-run     # build + show what WOULD upload, no upload
#   scripts/push.sh               # build + upload to the object store
#
# Config — set as env vars, or in a .env file at the repo root (never commit it):
#   S3_BUCKET     required   e.g. coin-registry
#   S3_ENDPOINT   required   e.g. https://fsn1.your-objectstorage.com
#   S3_REGION     optional   e.g. fsn1 (default: fsn1)
#   Credentials   optional   export AWS_PROFILE=hetz  (recommended locally)
#                            — or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
#
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Local convenience: load .env if present (gitignored).
if [[ -f .env ]]; then set -a; source .env; set +a; fi

echo "==> Validating & building"
npm run build

S3_PREFIX="${S3_PREFIX:-v1/coins}"
S3_PREFIX="${S3_PREFIX%/}"   # trim any trailing slash

# Local dist file  ->  published object key (under $S3_PREFIX)  ->  content-type.
# The canonical consumer path is $S3_PREFIX/list.json; server consumers (etl-api)
# fetch the raw-zstd sibling list.json.zst. application/zstd is passed through by
# Cloudflare unchanged (unlike .br/.gz, which CF recompresses).
UPLOADS=(
  "registry.json|$S3_PREFIX/list.json|application/json"
  "registry.min.json|$S3_PREFIX/list.min.json|application/json"
  "registry.meta.json|$S3_PREFIX/meta.json|application/json"
  "registry.json.zst|$S3_PREFIX/list.json.zst|application/zstd"
)

if [[ "$DRY_RUN" == 1 ]]; then
  echo "==> DRY RUN — would upload to s3://${S3_BUCKET:-<S3_BUCKET unset>}/ via ${S3_ENDPOINT:-<S3_ENDPOINT unset>}:"
  for u in "${UPLOADS[@]}"; do
    IFS='|' read -r local_f remote_k ctype <<< "$u"
    printf '    %-18s -> %-22s %-17s %8s bytes\n' "$local_f" "$remote_k" "$ctype" "$(wc -c < "dist/$local_f" | tr -d ' ')"
  done
  echo "==> No upload performed."
  exit 0
fi

: "${S3_BUCKET:?set S3_BUCKET (e.g. coin-registry)}"
: "${S3_ENDPOINT:?set S3_ENDPOINT (e.g. https://fsn1.your-objectstorage.com)}"
S3_REGION="${S3_REGION:-nbg1}"

AWS_ARGS=(--endpoint-url "$S3_ENDPOINT" --region "$S3_REGION")
if [[ -n "${AWS_PROFILE:-}" ]]; then AWS_ARGS+=(--profile "$AWS_PROFILE"); fi

echo "==> Uploading to s3://$S3_BUCKET/$S3_PREFIX/ via $S3_ENDPOINT"
for u in "${UPLOADS[@]}"; do
  IFS='|' read -r local_f remote_k ctype <<< "$u"
  aws s3 cp "dist/$local_f" "s3://$S3_BUCKET/$remote_k" \
    "${AWS_ARGS[@]}" \
    --content-type "$ctype" \
    --cache-control "public, max-age=60" \
    --acl public-read
done

echo "==> Done. Verify:  curl -s \"$S3_ENDPOINT/$S3_BUCKET/$S3_PREFIX/list.json\""
