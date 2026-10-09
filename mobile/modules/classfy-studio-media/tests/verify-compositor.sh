#!/bin/bash
set -euo pipefail
studio_compositor_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_compositor_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-studio-compositor.XXXXXX")"
if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=320x180:r=30:d=2 -c:v libx264 -pix_fmt yuv420p "$studio_compositor_directory/red.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=blue:s=180x320:r=30:d=2 -c:v libx264 -pix_fmt yuv420p "$studio_compositor_directory/blue.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=green:s=120x90 -frames:v 1 "$studio_compositor_directory/green.png"
xcrun swiftc -swift-version 5 -suppress-warnings -parse-as-library \
  "$studio_compositor_root/ios/StudioEffectRenderer.swift" \
  "$studio_compositor_root/ios/StudioVideoCompositor.swift" \
  "$studio_compositor_root/ios/StudioRecipeEngine.swift" \
  "$studio_compositor_root/tests/StudioVideoCompositor.tests.swift" \
  -o "$studio_compositor_directory/verify-compositor"
"$studio_compositor_directory/verify-compositor" "$studio_compositor_directory/red.mp4" "$studio_compositor_directory/blue.mp4" "$studio_compositor_directory/green.png"
