#!/bin/bash
set -euo pipefail
studio_recipe_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_recipe_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-studio-recipe.XXXXXX")"
if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=320x180:r=30:d=2 -c:v libx264 -pix_fmt yuv420p "$studio_recipe_directory/red.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=blue:s=180x320:r=30:d=2 -c:v libx264 -pix_fmt yuv420p "$studio_recipe_directory/blue.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=green:s=120x90 -frames:v 1 "$studio_recipe_directory/green.png"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=320x180:r=30:d=2 -vf 'drawbox=x=128:y=54:w=32:h=36:color=cyan:t=fill' -c:v libx264 -pix_fmt yuv420p "$studio_recipe_directory/main-marker.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i sine=frequency=880:sample_rate=48000:duration=2 -c:a aac "$studio_recipe_directory/voice.m4a"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=320x180:r=30:d=2 -vf 'drawbox=x=160:y=0:w=160:h=90:color=green:t=fill,drawbox=x=0:y=90:w=160:h=90:color=blue:t=fill,drawbox=x=160:y=90:w=160:h=90:color=yellow:t=fill' -c:v libx264 -pix_fmt yuv420p "$studio_recipe_directory/quadrants.mp4"
ffmpeg -hide_banner -loglevel error -display_rotation:v:0 90 -i "$studio_recipe_directory/quadrants.mp4" -c copy "$studio_recipe_directory/rotated-quadrants.mov"
if [[ -n "${STUDIO_ROTATION_FIXTURE:-}" ]]; then
  ffmpeg -hide_banner -loglevel error -display_rotation:v:0 90 -i "$STUDIO_ROTATION_FIXTURE" -t 8 -c copy "$studio_recipe_directory/rotated-real.mov"
fi
xcrun swiftc -swift-version 5 -suppress-warnings -parse-as-library "$studio_recipe_root/ios/StudioEffectRenderer.swift" "$studio_recipe_root/ios/StudioVideoCompositor.swift" "$studio_recipe_root/ios/StudioRecipeEngine.swift" "$studio_recipe_root/tests/StudioRecipeEngine.tests.swift" -o "$studio_recipe_directory/verify-recipe"
studio_recipe_args=("$studio_recipe_directory/red.mp4" "$studio_recipe_directory/blue.mp4" "$studio_recipe_directory/green.png" "$studio_recipe_directory/voice.m4a" "$studio_recipe_directory")
if [[ -n "${STUDIO_FACE_FIXTURE:-}" ]]; then studio_recipe_args+=("$STUDIO_FACE_FIXTURE"); fi
"$studio_recipe_directory/verify-recipe" "${studio_recipe_args[@]}"
xcrun swiftc -swift-version 5 -suppress-warnings -parse-as-library "$studio_recipe_root/ios/StudioEffectRenderer.swift" "$studio_recipe_root/ios/StudioVideoCompositor.swift" "$studio_recipe_root/ios/StudioRecipeEngine.swift" "$studio_recipe_root/tests/StudioVisualUpdate.tests.swift" -o "$studio_recipe_directory/verify-visual-update"
"$studio_recipe_directory/verify-visual-update" "$studio_recipe_directory/red.mp4" "$studio_recipe_directory/blue.mp4" "$studio_recipe_directory/green.png" "$studio_recipe_directory/main-marker.mp4" "$studio_recipe_directory"
