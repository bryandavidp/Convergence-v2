export const PROFILE_EMULATOR_BUILD_CONFIG = Object.freeze({
  artifactName: 'dist-profile-emulator',
  entryPoint: 'src/online/profile-emulator-bootstrap.ts',
  bundlePrefix: 'profile-emulator',
  connectOrigins: Object.freeze([
    'http://127.0.0.1:9099',
    'http://127.0.0.1:5001',
  ]),
});
