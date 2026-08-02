export type AppCheckMode = 'monitor' | 'enforce' | 'off';

export interface AppCheckConfig {
  mode: AppCheckMode;
  isTokenAutoRefreshEnabled: boolean;
  debugToken?: string;
  provider: 'play-integrity' | 'device-check' | 'recaptcha-v3' | 'debug';
}

export interface AppCheckOptions {
  env?: 'dev' | 'staging' | 'prod';
  debugToken?: string;
  modeOverride?: AppCheckMode;
}

export function getAppCheckConfig(options: AppCheckOptions = {}): AppCheckConfig {
  const env = options.env ?? 'dev';
  const mode = options.modeOverride ?? (env === 'prod' ? 'enforce' : 'monitor');

  if (env === 'dev' || mode === 'off') {
    return {
      mode,
      isTokenAutoRefreshEnabled: true,
      debugToken: options.debugToken ?? 'DEV_DEBUG_TOKEN_MONITOR',
      provider: 'debug',
    };
  }

  return {
    mode,
    isTokenAutoRefreshEnabled: true,
    provider: env === 'prod' ? 'play-integrity' : 'debug',
  };
}
