import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const studioMobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const studioReportRoot = mkdtempSync(join(tmpdir(), 'classfy-studio-headless-'));
const studioEnvironment = { ...process.env };
if (existsSync('/Applications/Xcode.app/Contents/Developer')) studioEnvironment.DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
const buildIOS = process.argv.includes('--build-ios');
const speechSmoke = process.argv.includes('--speech-smoke');
const installSpeechModel = process.argv.includes('--install-speech-model');
const unknownArguments = process.argv.slice(2).filter(value => !['--build-ios', '--speech-smoke', '--install-speech-model'].includes(value));
if (unknownArguments.length) throw new Error(`Opção desconhecida: ${unknownArguments.join(', ')}`);
if (installSpeechModel && !speechSmoke) throw new Error('--install-speech-model exige --speech-smoke.');

function sourceFingerprint() {
  const files = [];
  const visit = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) files.push(child);
    }
  };
  for (const folder of ['src/features/studio', 'modules/classfy-studio-media', 'app/studio']) visit(join(studioMobileRoot, folder));
  files.push(join(studioMobileRoot, 'package.json'), join(studioMobileRoot, 'tsconfig.json'), fileURLToPath(import.meta.url));
  const hash = createHash('sha256');
  for (const file of files.sort()) hash.update(relative(studioMobileRoot, file)).update('\0').update(readFileSync(file)).update('\0');
  return hash.digest('hex');
}
const git = args => spawnSync('git', args, { cwd: studioMobileRoot, encoding: 'utf8' }).stdout?.trim() ?? '';
const startedAt = new Date().toISOString();
const initialFingerprint = sourceFingerprint();
const steps = [
  { name: 'typescript', args: ['run', 'typecheck'], limitMs: 120_000 },
  { name: 'studio', args: ['run', 'test:studio'], limitMs: 120_000 },
  { name: 'navigation', args: ['run', 'test:navigation'], limitMs: 60_000 },
  { name: 'capture', args: ['run', 'test:studio:capture'], limitMs: 120_000 },
  { name: 'legacy-media', args: ['run', 'test:studio:media'], limitMs: 300_000 },
  { name: 'composition', args: ['run', 'test:studio:recipe'], limitMs: 180_000 },
  { name: 'composition-initial-frame', args: ['run', 'test:studio:initial-frame'], limitMs: 120_000 },
  { name: 'composition-interaction', args: ['run', 'test:studio:interaction'], limitMs: 180_000 },
  { name: 'transcription-contracts', args: ['run', 'test:studio:transcription'], limitMs: 180_000 },
];
if (speechSmoke) steps.push({ name: 'transcription-local', executable: 'bash', args: ['modules/classfy-studio-media/tests/verify-transcription-local.sh'],
  env: { STUDIO_TRANSCRIPTION_RUN_REAL: '1', STUDIO_TRANSCRIPTION_GENERATE_TTS: '1',
    STUDIO_TRANSCRIPTION_INSTALL_MODEL: installSpeechModel ? '1' : '0', STUDIO_TRANSCRIPTION_BENCHMARK: join(studioReportRoot, 'speech-benchmark.json') },
  limitMs: installSpeechModel ? 600_000 : 180_000 });
if (buildIOS) {
  // CocoaPods must discover newly added local Swift files before Xcode builds.
  // Preserve locked dependencies; no repository update or app deployment.
  steps.push({ name: 'ios-pods', executable: 'pod', args: ['install', '--no-repo-update', '--project-directory=ios'], limitMs: 300_000 });
  for (const [name, destination] of [['ios-simulator', 'generic/platform=iOS Simulator'], ['ios-device', 'generic/platform=iOS']]) {
    steps.push({ name, executable: 'xcodebuild', args: ['-workspace', 'ios/Classfy.xcworkspace', '-scheme', 'Classfy', '-configuration', 'Debug',
      '-destination', destination, '-derivedDataPath', join(studioReportRoot, name), 'build'], limitMs: 900_000 });
  }
}
const results = [];
function report() {
  const currentFingerprint = sourceFingerprint();
  const passed = results.length === steps.length && results.every(step => step.passed) && currentFingerprint === initialFingerprint;
  const value = { passed, validation: 'automated-headless', startedAt, finishedAt: new Date().toISOString(),
    revision: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']), trackedChanges: git(['status', '--short', '--untracked-files=no']),
    sourceFingerprint: initialFingerprint, sourceUnchangedDuringRun: currentFingerprint === initialFingerprint, buildIOS, speechSmoke, installSpeechModel,
    steps: results,
    physicalValidationPending: ['Sensor, lentes e microfone do iPhone', 'Fluidez e disposição visual por toque no aparelho', 'Qualidade visual em cena real no aparelho'],
  };
  writeFileSync(join(studioReportRoot, 'report.json'), JSON.stringify(value, null, 2));
  return value;
}
mkdirSync(studioReportRoot, { recursive: true });
console.log(`Validação automática do Studio. Evidência: ${studioReportRoot}`);
for (const step of steps) {
  console.log(`Iniciando ${step.name}…`);
  const start = performance.now();
  const executable = step.executable ?? 'npm';
  const result = spawnSync(executable, step.args, { cwd: studioMobileRoot, env: { ...studioEnvironment, ...step.env }, encoding: 'utf8',
    timeout: step.limitMs, maxBuffer: 32 * 1024 * 1024 });
  const logPath = join(studioReportRoot, `${step.name}.log`);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`;
  writeFileSync(logPath, output);
  const passed = result.status === 0 && !result.error;
  const counts = [...output.matchAll(/[ℹ#]\s+(tests|pass|fail|skipped)\s+(\d+)/g)];
  const testCounts = Object.fromEntries(counts.map(([, key, count]) => [key, Number(count)]));
  results.push({ name: step.name, passed, exitCode: result.status, signal: result.signal,
    durationMs: Math.round(performance.now() - start), logPath, ...(counts.length ? { testCounts } : {}) });
  report();
  console.log(`${passed ? 'OK' : 'FALHOU'} ${step.name} (${results.at(-1).durationMs} ms). ${logPath}`);
  if (!passed) {
    console.error(output.split('\n').slice(-28).join('\n'));
    process.exitCode = 1; break;
  }
}
const finalReport = report();
if (!finalReport.sourceUnchangedDuringRun) { console.error('O código mudou durante a validação; execute novamente quando as alterações terminarem.'); process.exitCode = 1; }
if (!finalReport.passed) process.exitCode = 1;
console.log(`Relatório: ${join(studioReportRoot, 'report.json')}`);
