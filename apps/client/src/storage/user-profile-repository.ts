import type {
  UserBestRecordsV1,
  UserProfileV1,
  UserSettingsV1,
} from '@convergence/contracts';
import {
  USER_PROFILE_SCHEMA_VERSION,
  userBestRecordsV1Schema,
  userProfileV1Schema,
  userSettingsV1Schema,
} from '@convergence/contracts';
import type { JsonRepository } from './json-repository.js';

export function defaultUserProfile(uid: string, now = Date.now()): UserProfileV1 {
  return {
    schemaVersion: USER_PROFILE_SCHEMA_VERSION,
    uid,
    displayName: 'Jugador',
    avatarIcon: 'icon-default',
    avatarBorder: 'border-default',
    theme: 'theme-classic',
    iconPack: 'pack-classic',
    updatedAt: now,
  };
}

export function defaultUserBestRecords(uid: string, now = Date.now()): UserBestRecordsV1 {
  return {
    schemaVersion: USER_PROFILE_SCHEMA_VERSION,
    uid,
    survivalBest: 0,
    survivalBestWave: 0,
    adventureMaxLevel: 1,
    bestCombo: 0,
    updatedAt: now,
  };
}

export function defaultUserSettings(now = Date.now()): UserSettingsV1 {
  return {
    schemaVersion: USER_PROFILE_SCHEMA_VERSION,
    soundVolume: 1,
    musicVolume: 1,
    hapticsEnabled: true,
    language: 'es',
    updatedAt: now,
  };
}

export class UserProfileRepository {
  constructor(
    private readonly jsonRepo: JsonRepository,
    private readonly now: () => number = Date.now,
  ) {}

  private profileKey(uid: string): string {
    return `user_profile_${uid}`;
  }

  private recordsKey(uid: string): string {
    return `user_records_${uid}`;
  }

  private settingsKey(): string {
    return 'user_settings';
  }

  async loadProfile(uid: string): Promise<UserProfileV1> {
    try {
      const loaded = await this.jsonRepo.read(
        this.profileKey(uid),
        (val): val is UserProfileV1 => userProfileV1Schema.safeParse(val).success,
      );
      return loaded ?? defaultUserProfile(uid, this.now());
    } catch {
      return defaultUserProfile(uid, this.now());
    }
  }

  async saveProfile(profile: UserProfileV1): Promise<void> {
    const validated = userProfileV1Schema.parse(profile);
    await this.jsonRepo.write(this.profileKey(validated.uid), validated);
  }

  async loadBestRecords(uid: string): Promise<UserBestRecordsV1> {
    try {
      const loaded = await this.jsonRepo.read(
        this.recordsKey(uid),
        (val): val is UserBestRecordsV1 => userBestRecordsV1Schema.safeParse(val).success,
      );
      return loaded ?? defaultUserBestRecords(uid, this.now());
    } catch {
      return defaultUserBestRecords(uid, this.now());
    }
  }

  async saveBestRecords(records: UserBestRecordsV1): Promise<void> {
    const validated = userBestRecordsV1Schema.parse(records);
    await this.jsonRepo.write(this.recordsKey(validated.uid), validated);
  }

  async loadSettings(): Promise<UserSettingsV1> {
    try {
      const loaded = await this.jsonRepo.read(
        this.settingsKey(),
        (val): val is UserSettingsV1 => userSettingsV1Schema.safeParse(val).success,
      );
      return loaded ?? defaultUserSettings(this.now());
    } catch {
      return defaultUserSettings(this.now());
    }
  }

  async saveSettings(settings: UserSettingsV1): Promise<void> {
    const validated = userSettingsV1Schema.parse(settings);
    await this.jsonRepo.write(this.settingsKey(), validated);
  }
}
