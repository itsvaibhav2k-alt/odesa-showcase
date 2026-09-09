import { Inngest } from 'inngest';

export const inngest = new Inngest({ id: 'odesa' });

// The operator worker MUST have its own app id — Inngest keys apps by id,
// and two services syncing the same id from different URLs overwrite each
// other (last sync wins, missing functions archived).
export const inngestOperatorWorker = new Inngest({ id: 'odesa-operator-worker' });
