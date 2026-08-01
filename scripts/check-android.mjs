import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const isWindows = process.platform === 'win32';
const executable = (name) => (isWindows ? `${name}.exe` : name);

const firstExisting = (candidates) =>
  candidates.find((candidate) => candidate && existsSync(candidate));

const childJavaBinaries = (root) => {
  if (!root || !existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, 'bin', executable('java')))
    .filter((candidate) => existsSync(candidate));
};

const programFiles = process.env.ProgramFiles;
const localAppData = process.env.LOCALAPPDATA;
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(
  projectRoot,
  'apps',
  'client',
  'android',
  'app',
  'src',
  'main',
  'AndroidManifest.xml',
);
const filePathsPath = join(
  projectRoot,
  'apps',
  'client',
  'android',
  'app',
  'src',
  'main',
  'res',
  'xml',
  'file_paths.xml',
);
const manifest = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : '';
const filePaths = existsSync(filePathsPath) ? readFileSync(filePathsPath, 'utf8') : '';

const studio = firstExisting([
  isWindows && programFiles
    ? join(programFiles, 'Android', 'Android Studio', 'bin', 'studio64.exe')
    : undefined,
  process.env.ANDROID_STUDIO,
]);

const bundledJava = firstExisting([
  isWindows && programFiles
    ? join(programFiles, 'Android', 'Android Studio', 'jbr', 'bin', executable('java'))
    : undefined,
]);
const javaHomeBinary = process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, 'bin', executable('java'))
  : undefined;
const userJavaBinaries = [
  ...childJavaBinaries(
    process.env.USERPROFILE
      ? join(process.env.USERPROFILE, '.jdks')
      : undefined,
  ),
  ...childJavaBinaries(
    process.env.USERPROFILE
      ? join(process.env.USERPROFILE, '.gradle', 'jdks')
      : undefined,
  ),
];
const javaCandidates = [
  javaHomeBinary,
  ...userJavaBinaries,
  bundledJava,
  executable('java'),
].filter(Boolean);
const javaProbes = [...new Set(javaCandidates)].map((binary) => {
  const probe = spawnSync(binary, ['-version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const output = `${probe.stdout ?? ''}${probe.stderr ?? ''}`.trim();
  return {
    binary,
    ok: probe.status === 0,
    output,
    major: Number(output.match(/version "(\d+)/)?.[1] ?? 0),
  };
});
const javaSelection =
  javaProbes.find((probe) => probe.ok && probe.major === 21) ??
  javaProbes.find((probe) => probe.ok);

const sdkRoot = firstExisting([
  process.env.ANDROID_SDK_ROOT,
  process.env.ANDROID_HOME,
  isWindows && localAppData
    ? join(localAppData, 'Android', 'Sdk')
    : undefined,
]);

const platform36 = sdkRoot
  ? join(sdkRoot, 'platforms', 'android-36')
  : undefined;
const adb = sdkRoot
  ? join(sdkRoot, 'platform-tools', executable('adb'))
  : undefined;
const emulator = sdkRoot
  ? join(sdkRoot, 'emulator', executable('emulator'))
  : undefined;
const sdkManager = sdkRoot
  ? join(
      sdkRoot,
      'cmdline-tools',
      'latest',
      'bin',
      isWindows ? 'sdkmanager.bat' : 'sdkmanager',
    )
  : undefined;

const checks = [
  ['Android Studio', Boolean(studio), studio ?? 'no detectado'],
  [
    'Java 21',
    javaSelection?.major === 21,
    javaSelection
      ? `${javaSelection.binary} — ${javaSelection.output}`
      : 'no detectado',
  ],
  ['SDK root', Boolean(sdkRoot), sdkRoot ?? 'no detectado'],
  ['Android Platform 36', Boolean(platform36 && existsSync(platform36)), platform36 ?? 'no detectado'],
  ['Platform-Tools / adb', Boolean(adb && existsSync(adb)), adb ?? 'no detectado'],
  ['Android Emulator', Boolean(emulator && existsSync(emulator)), emulator ?? 'no detectado'],
  [
    'Command-line Tools',
    Boolean(sdkManager && existsSync(sdkManager)),
    sdkManager ?? 'no detectado',
  ],
  [
    'Identidad y orientación Android',
    manifest.includes('android:screenOrientation="portrait"')
      && manifest.includes('android:name=".MainActivity"'),
    manifestPath,
  ],
  [
    'Backup local desactivado',
    manifest.includes('android:allowBackup="false"'),
    manifestPath,
  ],
  [
    'FileProvider restringido',
    manifest.includes('android:exported="false"')
      && !/<external-path\b/i.test(filePaths)
      && /<cache-path\b/i.test(filePaths),
    filePathsPath,
  ],
];

for (const [label, ok, detail] of checks) {
  console.log(`${ok ? 'OK' : 'MISSING'}  ${label}: ${detail}`);
}

if (checks.some(([, ok]) => !ok)) {
  console.error(
    '\nCompleta JDK 21, SDK Platform 36 y los componentes marcados como MISSING.',
  );
  process.exitCode = 1;
} else {
  console.log('\nToolchain Android listo para el primer build Gradle.');
}
