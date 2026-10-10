#!/bin/bash
set -euo pipefail
studio_tools_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_tools_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-studio-editor-tools.XXXXXX")"
if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer; fi
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=0x101010:s=640x360:r=30:d=2 -c:v libx264 -pix_fmt yuv420p "$studio_tools_directory/background.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=640x360:r=30:d=2 \
  -vf 'drawbox=x=320:y=0:w=320:h=180:color=green:t=fill,drawbox=x=0:y=180:w=320:h=180:color=blue:t=fill,drawbox=x=320:y=180:w=320:h=180:color=yellow:t=fill,drawbox=x=64:y=54:w=64:h=54:color=cyan:t=fill' \
  -c:v libx264 -pix_fmt yuv420p "$studio_tools_directory/quadrants.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=640x360:r=30:d=1 \
  -f lavfi -i color=c=blue:s=640x360:r=30:d=1 -f lavfi -i sine=frequency=880:sample_rate=48000:duration=2 \
  -filter_complex '[0:v][1:v]concat=n=2:v=1:a=0[v]' -map '[v]' -map 2:a -c:v libx264 -pix_fmt yuv420p -c:a aac "$studio_tools_directory/clock.mp4"
xcrun swiftc -swift-version 5 -suppress-warnings -parse-as-library \
  "$studio_tools_root/ios/StudioEffectRenderer.swift" "$studio_tools_root/ios/StudioVideoCompositor.swift" \
  "$studio_tools_root/ios/StudioRecipeVisualEffects.swift" "$studio_tools_root/ios/StudioRecipeEngine.swift" \
  "$studio_tools_root/tests/StudioEditorTools.tests.swift" -o "$studio_tools_directory/verify-editor-tools"
"$studio_tools_directory/verify-editor-tools" "$studio_tools_directory" "$@"
python3 "$studio_tools_root/tests/verify-editor-tools-audio.py" "$studio_tools_directory" "$@"
echo "Studio editor tools artifacts: $studio_tools_directory"
