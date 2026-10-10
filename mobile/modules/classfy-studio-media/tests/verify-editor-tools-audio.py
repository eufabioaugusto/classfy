"""Cross-check generated M4A timelines with an independent PCM decoder."""
import json
from pathlib import Path
import subprocess
import sys
from urllib.parse import unquote, urlparse

directory = Path(sys.argv[1]).resolve()
report_path = directory / ("audio-report.json" if "--audio-only" in sys.argv else "report.json")
report = json.loads(report_path.read_text())
checks = 0
for item in report["exports"]:
    if not item.get("hasAudio") or not item["uri"].endswith(".m4a"):
        continue
    source = Path(unquote(urlparse(item["uri"]).path)).resolve()
    if source.parent != directory:
        raise RuntimeError("Only generated fixture files may be decoded")
    decoded = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", str(source), "-vn", "-f", "f32le", "-ac", "1", "-ar", "48000", "pipe:1"],
        capture_output=True, check=True, timeout=30,
    ).stdout
    if not decoded or len(decoded) % 4:
        raise RuntimeError(f"Invalid PCM for {item['case']}")
    duration = len(decoded) / 4 / 48000
    expected = item["expectedDuration"]
    if abs(duration - expected) > 1 / 60 + 0.01:
        raise RuntimeError(f"Decoded audio outside unchanged60fps guard: {item['case']} expected={expected} actual={duration}")
    item["independentPCMDecodedDuration"] = duration
    checks += 1
report["independentAudioDecoderChecks"] = checks
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(f"Independent PCM decoder: {checks} M4A files preserve canonical timeline within60fps guard.")
