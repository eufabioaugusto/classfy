#!/bin/bash
set -euo pipefail
if [[ "${STUDIO_TRANSCRIPTION_RUN_REAL:-}" != "1" ]]; then
  printf '%s\n' 'Teste local real exige STUDIO_TRANSCRIPTION_RUN_REAL=1. Os testes normais nunca instalam modelos.' >&2
  exit 2
fi
studio_local_root="$(cd "$(dirname "$0")/.." && pwd)"
studio_local_directory="$(mktemp -d "${TMPDIR:-/tmp}/classfy-studio-local-speech.XXXXXX")"
if [[ "${STUDIO_TRANSCRIPTION_GENERATE_TTS:-}" == "1" ]]; then
  export STUDIO_TRANSCRIPTION_EXPECTED_TEXT='Bem-vindos ao Studio da Classfy. Nesta aula vamos aprender a organizar uma apresentação, gravar bons exemplos e revisar o conteúdo com calma. Primeiro, defina o objetivo da aula. Depois, escolha uma iluminação suave e fale com clareza. Por fim, confira as legendas e salve o seu projeto.'
  export STUDIO_TRANSCRIPTION_FIXTURE="$studio_local_directory/pt-BR-luciana.aiff"
  export STUDIO_TRANSCRIPTION_FIXTURE_KIND='local-synthesized-pt-BR-Luciana'
  say -v Luciana -r 150 -o "$STUDIO_TRANSCRIPTION_FIXTURE" "$STUDIO_TRANSCRIPTION_EXPECTED_TEXT"
fi
if [[ ! -f "${STUDIO_TRANSCRIPTION_FIXTURE:-}" || -z "${STUDIO_TRANSCRIPTION_EXPECTED_TEXT:-}" ]]; then
  printf '%s\n' 'Informe fixture de fala local e texto esperado, ou autorize STUDIO_TRANSCRIPTION_GENERATE_TTS=1.' >&2
  exit 2
fi
export STUDIO_TRANSCRIPTION_BENCHMARK="${STUDIO_TRANSCRIPTION_BENCHMARK:-$studio_local_directory/benchmark.json}"
printf 'Fixture: %s\nBenchmark: %s\nDownload explícito: %s\n' "$STUDIO_TRANSCRIPTION_FIXTURE" "$STUDIO_TRANSCRIPTION_BENCHMARK" "${STUDIO_TRANSCRIPTION_INSTALL_MODEL:-0}"
bash "$studio_local_root/tests/verify-transcription.sh"
