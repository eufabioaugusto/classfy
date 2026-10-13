#!/bin/bash
set -euo pipefail
studio_signature_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_signature_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-signature-native.XXXXXX")"
if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer; fi
ffmpeg -hide_banner -loglevel error -f lavfi -i 'color=c=0x505860:s=640x360:r=24:d=0.25' -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=0.25' -c:v libx264 -pix_fmt yuv420p -c:a aac "$studio_signature_directory/original.mp4"
xcrun swiftc -swift-version 5 -suppress-warnings -parse-as-library "$studio_signature_root/ios/StudioEffectRenderer.swift" "$studio_signature_root/ios/StudioVideoCompositor.swift" "$studio_signature_root/ios/StudioRecipeVisualEffects.swift" "$studio_signature_root/ios/StudioRecipeEngine.swift" "$studio_signature_root/tests/StudioSignature.tests.swift" -o "$studio_signature_directory/verify-signature"
studio_signature_args=("$studio_signature_directory")
if [[ -n "${STUDIO_SIGNATURE_REFERENCE:-}" ]]; then studio_signature_args+=("$STUDIO_SIGNATURE_REFERENCE"); fi
"$studio_signature_directory/verify-signature" "${studio_signature_args[@]}"
echo "Signature native evidence: $studio_signature_directory"
