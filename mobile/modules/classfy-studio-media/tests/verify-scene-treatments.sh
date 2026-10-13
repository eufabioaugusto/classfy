#!/bin/bash
set -euo pipefail
studio_treatment_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_treatment_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-scene-treatments.XXXXXX")"
if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer; fi
ffmpeg -hide_banner -loglevel error -f lavfi -i 'color=c=0x505860:s=640x360:r=24:d=0.5' -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=0.5' -c:v libx264 -pix_fmt yuv420p -c:a aac "$studio_treatment_directory/original.mp4"
xcrun swiftc -swift-version 5 -suppress-warnings -parse-as-library \
  "$studio_treatment_root/ios/StudioEffectRenderer.swift" "$studio_treatment_root/ios/StudioVideoCompositor.swift" \
  "$studio_treatment_root/ios/StudioRecipeVisualEffects.swift" "$studio_treatment_root/ios/StudioRecipeEngine.swift" \
  "$studio_treatment_root/tests/StudioSceneTreatments.tests.swift" -o "$studio_treatment_directory/verify-treatments"
"$studio_treatment_directory/verify-treatments" "$studio_treatment_directory"
echo "Synthetic treatments evidence: $studio_treatment_directory"
