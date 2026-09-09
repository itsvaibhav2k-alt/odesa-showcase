import {
  semanticMemoryReadiness,
  type SemanticMemoryEnvironment,
} from '@/lib/agent/memory/embed';

export type DeploymentRuntime = 'vercel' | 'operator-worker';

export type DeploymentEnvironment = SemanticMemoryEnvironment &
  Record<string, string | undefined>;

export interface DeploymentHealth {
  status: 200 | 503;
  body: {
    ok: boolean;
    service: string;
    semanticMemory: ReturnType<typeof semanticMemoryReadiness>;
    configuration: {
      status: 'configured' | 'degraded';
      missing: string[];
    };
  };
}

function present(raw: DeploymentEnvironment, key: string): boolean {
  return Boolean(raw[key]?.trim());
}

function durableAssistantEnabled(raw: DeploymentEnvironment): boolean {
  return (
    raw.NODE_ENV === 'production' ||
    raw.ODESA_DURABLE_CHAT === 'true' ||
    raw.NEXT_PUBLIC_DURABLE_CHAT === 'true' ||
    raw.DURABLE_CHAT_REQUIRE_INNGEST === 'true'
  );
}

/** Secret-free readiness for the two production runtimes. */
export function deploymentHealth(
  service: string,
  runtime: DeploymentRuntime,
  raw: DeploymentEnvironment = process.env,
): DeploymentHealth {
  const required = runtime === 'operator-worker'
    ? [
        'NEXT_PUBLIC_SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'INNGEST_SIGNING_KEY',
      ]
    : [
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        ...(durableAssistantEnabled(raw)
          ? ['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY']
          : []),
      ];
  const missing = required.filter((key) => !present(raw, key));
  const semanticMemory = semanticMemoryReadiness(raw);
  const ok = semanticMemory.configured && missing.length === 0;

  return {
    status: ok ? 200 : 503,
    body: {
      ok,
      service,
      semanticMemory,
      configuration: {
        status: missing.length === 0 ? 'configured' : 'degraded',
        missing,
      },
    },
  };
}
