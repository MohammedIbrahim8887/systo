#!/usr/bin/env bash
set -euo pipefail
# Pinned packaging tools; run on an x86_64 Linux build host.
tool_dir="${1:?Usage: setup-linux-packaging.sh TOOL_DIR}"
mkdir -p "$tool_dir"
tool_dir="$(cd "$tool_dir" && pwd)"
curl -fL --retry 3 https://github.com/goreleaser/nfpm/releases/download/v2.49.0/nfpm_2.49.0_Linux_x86_64.tar.gz -o "$tool_dir/nfpm.tar.gz"
echo "2afaa5ffb5e3493402e31e7c67a5a1fb42133e3f66fc315ca0051934125561c7  $tool_dir/nfpm.tar.gz" | sha256sum -c -
tar -xzf "$tool_dir/nfpm.tar.gz" -C "$tool_dir" nfpm
curl -fL --retry 3 https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage -o "$tool_dir/appimagetool"
echo "ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0  $tool_dir/appimagetool" | sha256sum -c -
chmod +x "$tool_dir/appimagetool"
