import { z } from 'zod';
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

/**
 * Espejo local de un documento de nube. `revision` es la última revisión que el
 * servidor aceptó para este cuerpo y `dirty` marca que hay ediciones locales que
 * el servidor todavía no ha visto. Sin `dirty` no se puede distinguir "voy
 * atrasado" de "he cambiado cosas", que es justo la diferencia entre adelantar
 * sin pérdida y machacar progreso ajeno.
 */
export interface LocalDocumentMirror<TBody> {
  revision: number;
  body: TBody;
  dirty: boolean;
}

function mirrorSchema<TSchema extends z.ZodTypeAny>(body: TSchema) {
  return z.strictObject({
    revision: z.number().int().nonnegative(),
    body,
    dirty: z.boolean(),
  });
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

  private profileMirrorKey(uid: string): string {
    return `user_profile_mirror_${uid}`;
  }

  private recordsMirrorKey(uid: string): string {
    return `user_records_mirror_${uid}`;
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

  /**
   * Lee el espejo con revisión. Si solo existe el cuerpo suelto de una versión
   * anterior lo adopta como revisión 0 y sucio: nunca se descarta lo local.
   */
  async loadProfileMirror(uid: string): Promise<LocalDocumentMirror<UserProfileV1>> {
    const schema = mirrorSchema(userProfileV1Schema);
    const loaded = await this.jsonRepo.read(
      this.profileMirrorKey(uid),
      (val): val is LocalDocumentMirror<UserProfileV1> => schema.safeParse(val).success,
    ).catch(() => null);
    if (loaded !== null) return loaded;
    return { revision: 0, body: await this.loadProfile(uid), dirty: true };
  }

  async saveProfileMirror(uid: string, mirror: LocalDocumentMirror<UserProfileV1>): Promise<void> {
    const validated = mirrorSchema(userProfileV1Schema).parse(mirror);
    await this.jsonRepo.write(this.profileMirrorKey(uid), validated);
    // El cuerpo suelto sigue siendo la lectura simple para el resto de la app.
    await this.saveProfile(validated.body as UserProfileV1);
  }

  async loadRecordsMirror(uid: string): Promise<LocalDocumentMirror<UserBestRecordsV1>> {
    const schema = mirrorSchema(userBestRecordsV1Schema);
    const loaded = await this.jsonRepo.read(
      this.recordsMirrorKey(uid),
      (val): val is LocalDocumentMirror<UserBestRecordsV1> => schema.safeParse(val).success,
    ).catch(() => null);
    if (loaded !== null) return loaded;
    return { revision: 0, body: await this.loadBestRecords(uid), dirty: true };
  }

  async saveRecordsMirror(
    uid: string,
    mirror: LocalDocumentMirror<UserBestRecordsV1>,
  ): Promise<void> {
    const validated = mirrorSchema(userBestRecordsV1Schema).parse(mirror);
    await this.jsonRepo.write(this.recordsMirrorKey(uid), validated);
    await this.saveBestRecords(validated.body as UserBestRecordsV1);
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
