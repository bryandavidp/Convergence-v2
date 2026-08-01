export type RuntimeKind = 'web' | 'native';

export interface PlatformStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PlatformHaptics {
  selection(): Promise<void>;
  impact(): Promise<void>;
}

export interface PlatformShare {
  canShare(): Promise<boolean>;
  share(data: {
    title?: string;
    text?: string;
    url?: string;
  }): Promise<void>;
}

export interface NetworkState {
  connected: boolean;
  connectionType: string;
}

export interface PlatformNetwork {
  current(): Promise<NetworkState>;
  subscribe(listener: (state: NetworkState) => void): Promise<() => Promise<void>>;
}

export interface PlatformServices {
  runtime: RuntimeKind;
  storage: PlatformStorage;
  haptics: PlatformHaptics;
  share: PlatformShare;
  network: PlatformNetwork;
}
