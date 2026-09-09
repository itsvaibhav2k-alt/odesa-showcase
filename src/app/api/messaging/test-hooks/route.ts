/**
 * Test-only endpoint for the messaging suite.
 *
 * Gated by `authorizeTestHooks()` (see `@/lib/test-hooks/guard`): fail-closed
 * on a shared-secret contract. Non-production (next dev / vitest) is open
 * unless a secret is configured; a production *build* additionally requires
 * the `MESSAGING_TEST_HOOKS=1` opt-in flag AND a matching secret header, so a
 * real deploy (no flag, no secret) returns 404 and can never be a backdoor.
 * Playwright's webServer sets the flag + secret and auto-sends the header.
 * Playwright specs hit this to:
 *   - install Claude mock scripts
 *   - toggle `shouldFail` per provider
 *   - read the list of recorded sends (for assertions)
 *   - reset the mock state between tests
 *
 * The shapes are intentionally permissive; this is test plumbing not
 * a public API.
 */

import { type NextRequest, NextResponse } from "next/server";

import { authorizeTestHooks } from "@/lib/test-hooks/guard";
import {
  installMessagingMock,
  uninstallMessagingMock,
  setShouldFail,
  setShouldTimeoutAfterAccept,
  resetRecorded,
  getRecorded,
  getMessagingMockState,
  setPauseBeforeHandoff,
} from "@/lib/messaging/test-hooks";
import {
  installClaudeMock,
  uninstallClaudeMock,
  setClaudeMockScripts,
  getClaudeMockRecorded,
  type ClaudeMockScript,
} from "@/lib/messaging/claude-draft";

function notAvailable(): NextResponse {
  return NextResponse.json(
    { success: false, error: "Not found" },
    { status: 404 },
  );
}

interface TestPostBody {
  action:
    | "install"
    | "uninstall"
    | "reset"
    | "set_should_fail"
    | "set_ambiguous_timeout"
    | "set_handoff_pause"
    | "set_claude_scripts";
  provider?: "linq" | "twilio" | "retell";
  value?: boolean;
  scripts?: ClaudeMockScript[];
}

export async function POST(req: NextRequest) {
  if (!authorizeTestHooks(req)) return notAvailable();

  let body: TestPostBody;
  try {
    body = (await req.json()) as TestPostBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  switch (body.action) {
    case "install": {
      installMessagingMock();
      installClaudeMock(body.scripts ?? []);
      return NextResponse.json({ success: true });
    }
    case "uninstall": {
      uninstallMessagingMock();
      uninstallClaudeMock();
      return NextResponse.json({ success: true });
    }
    case "reset": {
      resetRecorded();
      return NextResponse.json({ success: true });
    }
    case "set_should_fail": {
      if (!body.provider || typeof body.value !== "boolean") {
        return NextResponse.json(
          { success: false, error: "provider + value required" },
          { status: 400 },
        );
      }
      setShouldFail(body.provider, body.value);
      return NextResponse.json({ success: true });
    }
    case "set_ambiguous_timeout": {
      if (!body.provider || typeof body.value !== "boolean") {
        return NextResponse.json(
          { success: false, error: "provider + value required" },
          { status: 400 },
        );
      }
      setShouldTimeoutAfterAccept(body.provider, body.value);
      return NextResponse.json({ success: true });
    }
    case "set_handoff_pause": {
      if (typeof body.value !== "boolean") {
        return NextResponse.json(
          { success: false, error: "value required" },
          { status: 400 },
        );
      }
      setPauseBeforeHandoff(body.value);
      return NextResponse.json({ success: true });
    }
    case "set_claude_scripts": {
      setClaudeMockScripts(body.scripts ?? []);
      return NextResponse.json({ success: true });
    }
    default:
      return NextResponse.json(
        { success: false, error: "Unknown action" },
        { status: 400 },
      );
  }
}

export async function GET(req: NextRequest) {
  if (!authorizeTestHooks(req)) return notAvailable();
  return NextResponse.json({
    success: true,
    data: {
      installed: getMessagingMockState() !== null,
      handoffPaused: getMessagingMockState()?.handoffPaused ?? false,
      recorded: getRecorded(),
      claudeRecorded: getClaudeMockRecorded(),
    },
  });
}
