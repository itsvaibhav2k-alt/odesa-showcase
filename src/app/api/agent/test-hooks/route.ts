/**
 * Test-only endpoint for the v1.5 property-worker agent suite.
 *
 * Mirror of `/api/messaging/test-hooks`: gated by the shared fail-closed
 * `authorizeTestHooks()` (see `@/lib/test-hooks/guard`) — the flag alone is
 * NOT enough, a production build also needs a configured secret + matching
 * `x-test-hooks-secret` header, so real deploys return 404. Playwright specs
 * hit this to install/uninstall the Anthropic mock, set scripts, read
 * recorded calls, and reset between tests.
 *
 * The Playwright-side harness lives at `e2e/mocks/anthropic-mock.ts`;
 * this route's POST verbs are kept in lockstep with that harness's
 * `AnthropicHookAction` union.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { authorizeTestHooks } from '@/lib/test-hooks/guard';
import {
  appendAnthropicMockScripts,
  getAnthropicMockRecorded,
  getAnthropicMockState,
  installAnthropicMock,
  resetAnthropicMock,
  setAnthropicMockScripts,
  uninstallAnthropicMock,
  type AnthropicMockScript,
} from '@/lib/agent/test-hooks';

function notAvailable(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Not found' },
    { status: 404 },
  );
}

interface TestPostBody {
  action:
    | 'install_anthropic'
    | 'uninstall_anthropic'
    | 'reset_anthropic'
    | 'set_anthropic_scripts'
    | 'append_anthropic_scripts';
  scripts?: AnthropicMockScript[];
}

export async function POST(req: NextRequest) {
  if (!authorizeTestHooks(req)) return notAvailable();

  let body: TestPostBody;
  try {
    body = (await req.json()) as TestPostBody;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON' },
      { status: 400 },
    );
  }

  switch (body.action) {
    case 'install_anthropic': {
      installAnthropicMock(body.scripts ?? []);
      return NextResponse.json({ success: true });
    }
    case 'uninstall_anthropic': {
      uninstallAnthropicMock();
      return NextResponse.json({ success: true });
    }
    case 'reset_anthropic': {
      resetAnthropicMock();
      return NextResponse.json({ success: true });
    }
    case 'set_anthropic_scripts': {
      setAnthropicMockScripts(body.scripts ?? []);
      return NextResponse.json({ success: true });
    }
    case 'append_anthropic_scripts': {
      appendAnthropicMockScripts(body.scripts ?? []);
      return NextResponse.json({ success: true });
    }
    default:
      return NextResponse.json(
        { success: false, error: 'Unknown action' },
        { status: 400 },
      );
  }
}

export async function GET(req: NextRequest) {
  if (!authorizeTestHooks(req)) return notAvailable();
  return NextResponse.json({
    success: true,
    data: {
      installed: getAnthropicMockState() !== null,
      anthropicRecorded: getAnthropicMockRecorded(),
    },
  });
}
