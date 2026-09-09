/**
 * Calls Review Desk — accessibility coverage for the three primary states:
 * empty register, populated register, and full Call Review Studio.
 *
 * A safe local test call supplies a real call artifact through the product UI;
 * the artifact is removed after the scan. Known warm-paper palette and nested
 * dashboard-landmark exceptions match the rest of the operator console.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  HAVE_SUPABASE,
  createAdmin,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from "../today/helpers";

const A11Y_RULE_EXCLUSIONS = [
  "color-contrast",
  "landmark-no-duplicate-main",
  "landmark-main-is-top-level",
  "landmark-unique",
] as const;

async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .disableRules([...A11Y_RULE_EXCLUSIONS])
    .analyze();
  expect(
    results.violations,
    `axe violations in state="${label}":\n${JSON.stringify(results.violations, null, 2)}`,
  ).toEqual([]);
}

test.describe("calls review desk: accessibility", () => {
  test.skip(
    !HAVE_SUPABASE,
    "Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run",
  );

  let owner: SeededOwner;
  let callId: string | null = null;

  test.afterEach(async () => {
    if (callId) {
      const admin = createAdmin();
      const { data: call } = await admin
        .from("voice_calls")
        .select("retell_call_id, conversation_id")
        .eq("id", callId)
        .maybeSingle();
      if (call?.conversation_id) {
        await admin
          .from("messages")
          .delete()
          .eq("conversation_id", call.conversation_id);
        await admin
          .from("conversations")
          .delete()
          .eq("id", call.conversation_id);
      }
      if (call?.retell_call_id) {
        await admin
          .from("voice_calls")
          .delete()
          .eq("retell_call_id", call.retell_call_id);
      }
    }
    if (owner) await owner.teardown();
  });

  test("axe: empty desk, populated register, and call sheet have zero violations", async ({
    page,
  }) => {
    test.setTimeout(45_000);
    owner = await provisionGalaxyOwner();
    await signIn(page, { email: owner.email, password: owner.password });

    await page.goto("/calls");
    await expect(page.getByTestId("calls-page")).toBeVisible();
    await expectNoAxeViolations(page, "empty-register");

    // The daily Calls overview intentionally omits setup/test commands. This
    // route remains directly reachable as an explicitly local simulation.
    await page.goto("/calls/test");
    await expect(page.getByTestId("calls-test-page")).toBeVisible();
    await expect(page.getByTestId("calls-test-page")).toContainText(
      "Local simulation",
    );
    await page.getByTestId("test-call-button").click();
    await page.waitForURL(/\/calls\/[a-f0-9-]+/, { timeout: 10_000 });
    callId = page.url().split("/calls/")[1] ?? null;
    await expect(page.getByTestId("call-detail-page")).toBeVisible();
    await expectNoAxeViolations(page, "call-sheet");

    await page.goto("/calls");
    await page.waitForURL(/\/calls$/);
    await expect(page.getByTestId("calls-register-rows")).toBeVisible();
    await expect(page.getByRole("tablist")).toHaveCount(0);
    const allFilter = page.getByTestId("calls-filter-all");
    const resolvedFilter = page.getByTestId("calls-filter-resolved");
    await expect(allFilter).toHaveAttribute("aria-pressed", "true");
    await resolvedFilter.focus();
    await page.keyboard.press("Enter");
    await expect(resolvedFilter).toHaveAttribute("aria-pressed", "true");
    await expect(allFilter).toHaveAttribute("aria-pressed", "false");
    await expectNoAxeViolations(page, "populated-register");
  });
});
