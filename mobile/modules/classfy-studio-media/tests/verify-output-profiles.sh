#!/bin/bash
set -euo pipefail
studio_output_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_output_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-studio-output-profiles.XXXXXX")"
trap 'rm -rf "$studio_output_directory"' EXIT
if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=3840x2160:r=60:d=0.3 \
  -f lavfi -i sine=frequency=440:sample_rate=48000:duration=0.3 \
  -vf 'drawbox=x=1536:y=648:w=384:h=432:color=cyan:t=fill' \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac "$studio_output_directory/source-4k60.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=blue:s=64x36:r=30:d=0.3 \
  -c:v libx265 -preset ultrafast -pix_fmt yuv420p10le -x265-params log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc \
  -color_primaries bt2020 -color_trc arib-std-b67 -colorspace bt2020nc -tag:v hvc1 -movflags +write_colr "$studio_output_directory/tagged-hlg.mp4"
xcrun swiftc -swift-version 5 -suppress-warnings -parse-as-library \
  "$studio_output_root/ios/StudioEffectRenderer.swift" "$studio_output_root/ios/StudioVideoCompositor.swift" \
  "$studio_output_root/ios/StudioRecipeEngine.swift" "$studio_output_root/ios/StudioExportIdleLease.swift" "$studio_output_root/ios/StudioMediaEngine.swift" \
  "$studio_output_root/tests/StudioOutputProfiles.tests.swift" -o "$studio_output_directory/verify-output-profiles"
studio_output_args=("$studio_output_directory")
if [[ -n "${STUDIO_OUTPUT_REPORT:-}" ]]; then studio_output_args+=("$STUDIO_OUTPUT_REPORT"); fi
/usr/bin/time -l "$studio_output_directory/verify-output-profiles" "${studio_output_args[@]}"
