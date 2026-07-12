#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 /absolute/output/path/silverc" >&2
  exit 2
fi

output="$1"
silverscript_commit="956868ea63a2af4176889f1331449b5f4f9e1df8"
workdir="$(mktemp -d "${TMPDIR:-/tmp}/silverc.XXXXXX")"
target_dir="${CARGO_TARGET_DIR:-$workdir/silverscript/target}"
trap 'rm -rf "$workdir"' EXIT

git clone --filter=blob:none --no-checkout https://github.com/kaspanet/silverscript.git "$workdir/silverscript"
git -C "$workdir/silverscript" checkout --detach "$silverscript_commit"
cargo build --manifest-path "$workdir/silverscript/Cargo.toml" -p silverscript-lang --bin silverc --release

mkdir -p "$(dirname "$output")"
install -m 0755 "$target_dir/release/silverc" "$output"
"$output" --help
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$output"
else
  shasum -a 256 "$output"
fi
