#!/bin/bash
set -euo pipefail
studio_export_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_export_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-studio-export-recovery.XXXXXX")"
trap 'rm -rf "$studio_export_directory"' EXIT
if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=s=320x180:r=30:d=2 \
  -f lavfi -i sine=frequency=440:sample_rate=48000:duration=2 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac "$studio_export_directory/source.mp4"
xcrun swiftc -swift-version 5 -suppress-warnings -parse-as-library \
  "$studio_export_root/ios/StudioEffectRenderer.swift" "$studio_export_root/ios/StudioVideoCompositor.swift" \
  "$studio_export_root/ios/StudioRecipeVisualEffects.swift" "$studio_export_root/ios/StudioRecipeEngine.swift" "$studio_export_root/tests/StudioExportRecovery.tests.swift" \
  -o "$studio_export_directory/verify-export-recovery"
"$studio_export_directory/verify-export-recovery" "$studio_export_directory"
