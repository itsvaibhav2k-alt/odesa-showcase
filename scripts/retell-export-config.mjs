/**
 * retell-export-config — print the code-derived Retell config as JSON for
 * manual dashboard setup.
 *
 * NO network, NO auto-sync, NO secrets. The auth header value is a hard-coded
 * redaction placeholder — the real RETELL_API_KEY is never read or printed.
 * Retell dashboard configuration stays a manual copy-paste (see agent-prompt.ts
 * and research §7); this script only shows you what to paste.
 *
 * Usage:  NEXT_PUBLIC_APP_URL=https://your-host npx tsx scripts/retell-export-config.mjs
 *         (falls back to a placeholder base URL if the env var is unset)
 */

import { buildRetellConfig } from '../src/lib/voice/providers/retell-config.ts';

const config = buildRetellConfig({
  authHeaderValue: 'Bearer <REDACTED: set to RETELL_API_KEY in the dashboard>',
});

process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
