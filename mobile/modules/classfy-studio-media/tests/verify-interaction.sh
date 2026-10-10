#!/bin/bash
set -euo pipefail
studio_interaction_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_interaction_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-studio-interaction.XXXXXX")"
trap 'rm -rf "$studio_interaction_directory"' EXIT
if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=320x180:r=30:d=2 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac "$studio_interaction_directory/red.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=blue:s=180x320:r=30:d=2 -c:v libx264 -pix_fmt yuv420p "$studio_interaction_directory/blue.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=green:s=120x90 -frames:v 1 "$studio_interaction_directory/green.png"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=320x180:r=24:d=2 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac "$studio_interaction_directory/red24.mp4"
xcrun swiftc -swift-version 5 -suppress-warnings -parse-as-library \
  "$studio_interaction_root/ios/StudioEffectRenderer.swift" "$studio_interaction_root/ios/StudioVideoCompositor.swift" \
  "$studio_interaction_root/ios/StudioRecipeVisualEffects.swift" "$studio_interaction_root/ios/StudioRecipeEngine.swift" "$studio_interaction_root/ios/StudioCompositionInteraction.swift" \
  "$studio_interaction_root/ios/StudioCompositionView.swift" \
  "$studio_interaction_root/tests/StudioCompositionInteraction.tests.swift" -o "$studio_interaction_directory/verify-interaction"
"$studio_interaction_directory/verify-interaction" "$studio_interaction_directory/red.mp4" "$studio_interaction_directory/blue.mp4" "$studio_interaction_directory/green.png" "$studio_interaction_directory/red24.mp4"
