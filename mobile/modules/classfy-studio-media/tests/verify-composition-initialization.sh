#!/bin/bash
set -euo pipefail
studio_initial_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_initial_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-studio-initial-frame.XXXXXX")"
if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=320x180:r=30:d=2 -c:v libx264 -pix_fmt yuv420p "$studio_initial_directory/red.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=green:s=120x90 -frames:v 1 "$studio_initial_directory/green.png"
xcrun swiftc -swift-version 5 -suppress-warnings -parse-as-library \
  "$studio_initial_root/ios/StudioEffectRenderer.swift" "$studio_initial_root/ios/StudioVideoCompositor.swift" \
  "$studio_initial_root/ios/StudioRecipeEngine.swift" "$studio_initial_root/ios/StudioCompositionView.swift" \
  "$studio_initial_root/tests/StudioCompositionInitialization.tests.swift" -o "$studio_initial_directory/verify-initial-frame"
"$studio_initial_directory/verify-initial-frame" "$studio_initial_directory/red.mp4" "$studio_initial_directory/green.png"
