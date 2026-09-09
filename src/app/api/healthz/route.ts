import { NextResponse } from 'next/server';

import { deploymentHealth } from '@/lib/health/readiness';

export const dynamic = 'force-dynamic';

/** Vercel readiness: mandatory dependencies are explicit and secret-free. */
export async function GET(): Promise<NextResponse> {
  const health = deploymentHealth('odesa-vercel', 'vercel');
  return NextResponse.json(health.body, { status: health.status });
}
