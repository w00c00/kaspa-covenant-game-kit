#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 /absolute/output/path/kascov-lab" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output="$1"
kascov_commit="fdc0396aaa990e72b8b81c5f459650bcec4041e9"
workdir="$(mktemp -d "${TMPDIR:-/tmp}/kascov-mainnet-runner.XXXXXX")"
target_dir="${CARGO_TARGET_DIR:-$workdir/kascov/target}"
trap 'rm -rf "$workdir"' EXIT

git clone --filter=blob:none --no-checkout https://github.com/Knitser/kascov.git "$workdir/kascov"
git -C "$workdir/kascov" checkout --detach "$kascov_commit"
git -C "$workdir/kascov" apply "$repo_root/tools/kascov-mainnet-runner/kascov-mainnet.patch"

cargo test --manifest-path "$workdir/kascov/Cargo.toml" -p kascov-labkit --lib
cargo build --manifest-path "$workdir/kascov/Cargo.toml" -p kascov-lab --release

mkdir -p "$(dirname "$output")"
install -m 0755 "$target_dir/release/kascov-lab" "$output"
"$output" --help
"$output" settle-escrow --help
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$output"
else
  shasum -a 256 "$output"
fi
