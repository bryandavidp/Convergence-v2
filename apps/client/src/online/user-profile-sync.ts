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
import type { UserProfileRepository } from '../storage/user-profile-repository.js';
import type { Outbox } from '../storage/outbox.js';

export const USER_PROFILE_OUTBOX_KIND = 'user-profile-update-v1';

export function mergeUserBestRecords(
  local: UserBestRecordsV1,
  remote: UserBestRecordsV1,
  now = Date.now(),
): UserBestRecordsV1 {
  const merged: UserBestRecordsV1 = {
    schemaVersion: USER_PROFILE_SCHEMA_VERSION,
    uid: local.uid,
    survivalBest: Math.max(local.survivalBest, remote.survivalBest),
    survivalBestWave: Math.max(local.survivalBestWave, remote.survivalBestWave),
    adventureMaxLevel: Math.max(local.adventureMaxLevel, remote.adventureMaxLevel),
    bestCombo: Math.max(local.bestCombo, remote.bestCombo),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt, now),
  };
  return userBestRecordsV1Schema.parse(merged);
}

export interface ProfileSyncTransport {
  fetchRemoteProfile(uid: string): Promise<UserProfileV1 | null>;
  pushProfile(profile: UserProfileV1): Promise<void>;
  fetchRemoteRecords(uid: string): Promise<UserBestRecordsV1 | null>;
  pushRecords(records: UserBestRecordsV1): Promise<void>;
}

export class UserProfileSyncCoordinator {
  constructor(
    private readonly uid: string,
    private readonly repository: UserProfileRepository,
    private readonly outbox: Outbox,
    private readonly transport: ProfileSyncTransport,
    private readonly now: () => number = Date.now,
  ) {}

  async syncProfile(): Promise<UserProfileV1> {
    const local = await this.repository.loadProfile(this.uid);
    try {
      const remote = await this.transport.fetchRemoteProfile(this.uid);
      if (remote === null) {
        await this.transport.pushProfile(local);
        return local;
      }
      if (remote.updatedAt > local.updatedAt) {
        await this.repository.saveProfile(remote);
        return remote;
      } else if (local.updatedAt > remote.updatedAt) {
        await this.transport.pushProfile(local);
      }
      return local;
    } catch {
      await this.outbox.enqueue({
        id: `profile-${this.uid}-${local.updatedAt}`,
        ownerUid: this.uid,
        kind: USER_PROFILE_OUTBOX_KIND,
        createdAt: local.updatedAt,
        payload: local,
      });
      return local;
    }
  }

  async syncBestRecords(): Promise<UserBestRecordsV1> {
    const local = await this.repository.loadBestRecords(this.uid);
    try {
      const remote = await this.transport.fetchRemoteRecords(this.uid);
      if (remote === null) {
        await this.transport.pushRecords(local);
        return local;
      }
      const merged = mergeUserBestRecords(local, remote, this.now());
      await this.repository.saveBestRecords(merged);
      await this.transport.pushRecords(merged);
      return merged;
    } catch {
      await this.outbox.enqueue({
        id: `records-${this.uid}-${local.updatedAt}`,
        ownerUid: this.uid,
        kind: 'user-records-update-v1',
        createdAt: local.updatedAt,
        payload: local,
      });
      return local;
    }
  }
}
