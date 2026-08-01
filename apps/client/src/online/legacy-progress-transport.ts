import type {
  LegacyProgressCommitResultV1,
  LegacyProgressCommitV1,
  LegacyProgressImportV1,
  LegacyProgressPreviewResultV1,
} from '@convergence/contracts';
import {
  legacyProgressCommitResultV1Schema,
  legacyProgressPreviewResultV1Schema,
} from '@convergence/contracts';
import {
  httpsCallable,
  type Functions,
  type HttpsCallable,
} from 'firebase/functions';

export interface LegacyProgressTransport {
  preview(input: LegacyProgressImportV1): Promise<LegacyProgressPreviewResultV1>;
  commit(input: LegacyProgressCommitV1): Promise<LegacyProgressCommitResultV1>;
}

interface LegacyProgressCallables {
  preview: HttpsCallable<LegacyProgressImportV1, unknown>;
  commit: HttpsCallable<LegacyProgressCommitV1, unknown>;
}

export function createFirebaseLegacyProgressTransport(
  functions: Functions,
  callables: LegacyProgressCallables = {
    preview: httpsCallable(functions, 'previewLegacyProgressImport', {
      timeout: 15_000,
    }),
    commit: httpsCallable(functions, 'commitLegacyProgressImport', {
      timeout: 15_000,
    }),
  },
): LegacyProgressTransport {
  return {
    async preview(input) {
      const response = await callables.preview(input);
      return legacyProgressPreviewResultV1Schema.parse(response.data);
    },
    async commit(input) {
      const response = await callables.commit(input);
      return legacyProgressCommitResultV1Schema.parse(response.data);
    },
  };
}
