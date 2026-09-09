import { describe, expect, it } from 'vitest';

import {
  deploymentHealth,
  type DeploymentEnvironment,
} from '../readiness';

function configured(overrides: DeploymentEnvironment = {}): DeploymentEnvironment {
  return {
    NODE_ENV: 'production',
    OPENAI_API_KEY: 'openai-secret',
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-secret',
    SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
    INNGEST_EVENT_KEY: 'event-secret',
    INNGEST_SIGNING_KEY: 'signing-secret',
    ...overrides,
  };
}

describe('deploymentHealth', () => {
  it.each([
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'INNGEST_EVENT_KEY',
    'INNGEST_SIGNING_KEY',
  ])('returns 503 when production Vercel is missing %s', (key) => {
    const raw = configured({ [key]: '' });
    const health = deploymentHealth('odesa-vercel', 'vercel', raw);
    expect(health.status).toBe(503);
    expect(health.body.configuration.missing).toContain(key);
  });

  it('requires Inngest whenever durable assistant is enabled outside production', () => {
    const health = deploymentHealth('odesa-vercel', 'vercel', configured({
      NODE_ENV: 'test',
      NEXT_PUBLIC_DURABLE_CHAT: 'true',
      INNGEST_EVENT_KEY: '',
      INNGEST_SIGNING_KEY: '',
    }));
    expect(health.status).toBe(503);
    expect(health.body.configuration.missing).toEqual([
      'INNGEST_EVENT_KEY',
      'INNGEST_SIGNING_KEY',
    ]);
  });

  it('uses the worker-specific Supabase and Inngest signing requirements', () => {
    const green = deploymentHealth(
      'odesa-operator-worker',
      'operator-worker',
      configured({ NEXT_PUBLIC_SUPABASE_ANON_KEY: '', INNGEST_EVENT_KEY: '' }),
    );
    expect(green.status).toBe(200);

    const red = deploymentHealth(
      'odesa-operator-worker',
      'operator-worker',
      configured({ INNGEST_SIGNING_KEY: '' }),
    );
    expect(red.status).toBe(503);
    expect(red.body.configuration.missing).toEqual(['INNGEST_SIGNING_KEY']);
  });

  it('returns 200 only when configured and never serializes secret values', () => {
    const raw = configured();
    const health = deploymentHealth('odesa-vercel', 'vercel', raw);
    const serialized = JSON.stringify(health);
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    for (const secret of [
      raw.OPENAI_API_KEY,
      raw.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      raw.SUPABASE_SERVICE_ROLE_KEY,
      raw.INNGEST_EVENT_KEY,
      raw.INNGEST_SIGNING_KEY,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
