/** Autoplay policies may leave resume() pending forever. Never keep authorized
 * sources alive indefinitely while waiting for the recording audio graph. */
export async function resumeStudioCaptureAudio(context: AudioContext, assert: () => void = () => {}) {
  assert();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      context.resume(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('O navegador não ativou o áudio da gravação. Volte ao Studio e ative a captura novamente.')), 8000); }),
    ]);
    assert();
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
