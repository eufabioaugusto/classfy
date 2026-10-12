#!/bin/bash
set -euo pipefail
studio_capture_speech_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_capture_speech_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-studio-capture-speech.XXXXXX")"
trap 'rm -rf "$studio_capture_speech_directory"' EXIT
if [[ -d /Applications/Xcode.app/Contents/Developer ]]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
xcrun swiftc -swift-version 5 -typecheck \
  "$studio_capture_speech_root/ios/StudioCaptureAudioMonitor.swift" \
  "$studio_capture_speech_root/ios/StudioCaptureSpeechState.swift" \
  "$studio_capture_speech_root/ios/StudioCaptureSpeechAudioRoute.swift" \
  "$studio_capture_speech_root/ios/StudioCaptureSpeech.swift"
if [[ "${STUDIO_CAPTURE_SPEECH_USE_INTERPRETER:-}" == "1" ]]; then
  # Some Mac sessions stall newly generated ad-hoc executables before main.
  # Run the same native CoreMedia fixtures through Xcode's trusted Swift tool;
  # this does not change signing policy or any macOS protection.
  python3 - "$studio_capture_speech_root" "$studio_capture_speech_directory" <<'PY'
from pathlib import Path
import sys
root, destination = map(Path, sys.argv[1:])
sources = [(root / 'ios/StudioCaptureSpeechState.swift').read_text(),
           (root / 'ios/StudioCaptureSpeechAudioRoute.swift').read_text(),
           (root / 'tests/StudioCaptureSpeechStateTests.swift').read_text().replace('@main\n', '')]
(destination / 'verify.swift').write_text('\n'.join(sources) + '\ntry StudioCaptureSpeechStateTests.main()\n')
PY
  xcrun swift -swift-version 6 "$studio_capture_speech_directory/verify.swift"
  exit
fi
xcrun swiftc -swift-version 6 -parse-as-library \
  "$studio_capture_speech_root/ios/StudioCaptureSpeechState.swift" \
  "$studio_capture_speech_root/ios/StudioCaptureSpeechAudioRoute.swift" \
  "$studio_capture_speech_root/tests/StudioCaptureSpeechStateTests.swift" \
  -o "$studio_capture_speech_directory/verify-capture-speech"
"$studio_capture_speech_directory/verify-capture-speech"
