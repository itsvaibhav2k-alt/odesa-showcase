/**
 * Settings — Team & Access invitation lifecycle.
 *
 * No provider messages are sent. The owner creates a one-time copyable link,
 * and the fresh invitee signs up and explicitly claims it. All mutations are
 * hard-gated to loopback Supabase and every fixture is removed.
 */

import { expect, test } from "@playwright/test";

import {
  createAdmin,
  GALAXY_ORG_ID,
  HAVE_LOCAL_SUPABASE,
  provisionGalaxyOwner,
  signInAndOpenSettings,
  type SeededOwner,
} from "./helpers";

test.describe("settings: team", () => {
  test.skip(
    !HAVE_LOCAL_SUPABASE,
    "Skipped: invitation mutation coverage requires loopback Supabase credentials",
  );

  let owner: SeededOwner;
  let invitationId: string | null;
  let inviteeUserId: string | null;
  let inviteeEmail: string | null;

  test.beforeEach(async () => {
    invitationId = null;
    inviteeUserId = null;
    inviteeEmail = null;
    owner = await provisionGalaxyOwner();
  });

  test.afterEach(async () => {
    const admin = createAdmin();
    if (invitationId) {
      await admin
        .from("organization_invitations")
        .delete()
        .eq("id", invitationId);
    }
    if (!inviteeUserId && inviteeEmail) {
      const listed = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      inviteeUserId =
        listed.data?.users.find((user) => user.email === inviteeEmail)?.id ??
        null;
    }
    if (inviteeUserId) {
      await admin.auth.admin.deleteUser(inviteeUserId).catch(() => undefined);
    }
    if (owner) await owner.teardown();
  });

  test("renders the team list with the seeded owner role", async ({ page }) => {
    await signInAndOpenSettings(page, {
      email: owner.email,
      password: owner.password,
    });

    const section = page.getByTestId("settings-team-section");
    await expect(section).toBeVisible();

    const admin = createAdmin();
    const { data: seededOwner, error } = await admin
      .from("users")
      .select("id")
      .eq("organization_id", GALAXY_ORG_ID)
      .eq("email", "owner@galaxy-estates.test")
      .single();
    if (error || !seededOwner) {
      throw new Error(
        "Seeded Galaxy owner owner@galaxy-estates.test missing — reseed the Galaxy org",
      );
    }

    const roleChip = page.getByTestId(
      `settings-team-member-role-${seededOwner.id}`,
    );
    await expect(roleChip).toHaveAttribute("data-role", "owner");
    await expect(roleChip).toHaveText("Owner");
    await expect(
      page.getByTestId(`settings-team-member-${owner.userId}`),
    ).toHaveCount(0);
  });

  test("creates a property-scoped Property manager link and claims it with a fresh account", async ({
    page,
  }) => {
    const admin = createAdmin();
    const { data: properties, error: propertyError } = await admin
      .from("properties")
      .select("id, name")
      .eq("organization_id", GALAXY_ORG_ID)
      .is("archived_at", null)
      .order("name")
      .limit(1);
    if (propertyError || !properties?.[0]) {
      throw new Error(
        `Galaxy property fixture missing: ${propertyError?.message ?? "no active property"}`,
      );
    }
    const property = properties[0];
    const stamp = `${Date.now()}.${Math.floor(Math.random() * 1e6)}`;
    inviteeEmail = `invited-manager.${stamp}@galaxy.test`;
    const password = `invited-manager-${stamp}-secret`;

    await signInAndOpenSettings(page, {
      email: owner.email,
      password: owner.password,
    });

    const role = page.getByTestId("settings-team-invite-role");
    await role.selectOption("manager");
    await expect(role.locator("option:checked")).toHaveText("Property manager");
    await page.getByTestId("settings-team-invite-email").fill(inviteeEmail);
    await page
      .getByTestId(`settings-team-invite-property-${property.id}`)
      .check();
    await page.getByTestId("settings-team-invite-submit").click();

    const link = page.getByTestId("settings-team-invite-link");
    await expect(link).toBeVisible();
    const inviteUrl = await link.inputValue();
    const parsedInvite = new URL(inviteUrl);
    const token = decodeURIComponent(
      parsedInvite.pathname.slice("/invite/".length),
    );
    expect(token).toMatch(/^[a-f0-9]{64}$/i);
    await expect(
      page.getByText("No email is sent.", { exact: false }),
    ).toBeVisible();

    const { data: invitation, error: invitationError } = await admin
      .from("organization_invitations")
      .select(
        "id, role, all_properties, token_hash, organization_invitation_property_grants(property_id)",
      )
      .eq("organization_id", GALAXY_ORG_ID)
      .eq("email", inviteeEmail)
      .single();
    if (invitationError || !invitation) {
      throw new Error(
        `Invitation fixture missing: ${invitationError?.message ?? "no row"}`,
      );
    }
    invitationId = invitation.id;
    expect(invitation).toMatchObject({
      role: "manager",
      all_properties: false,
      organization_invitation_property_grants: [{ property_id: property.id }],
    });
    expect(invitation.token_hash).not.toBe(token);

    await page.context().clearCookies();
    await page.goto(inviteUrl);
    await expect(page.getByTestId("invite-sign-in")).toHaveAttribute(
      "href",
      `/login?next=${encodeURIComponent(parsedInvite.pathname)}`,
    );
    await page.getByTestId("invite-create-account").click();
    await expect(page).toHaveURL(`/signup?invite=${token}`);
    await expect(page.getByTestId("signup-organization")).toHaveCount(0);

    await page.getByTestId("signup-fullname").fill("Invited Property Manager");
    await page.getByTestId("signup-email").fill(inviteeEmail);
    await page.getByTestId("signup-password").fill(password);
    await page.getByTestId("signup-submit").click();

    await expect(page).toHaveURL(parsedInvite.pathname);
    await expect(page.getByTestId("invite-claim-submit")).toBeVisible();
    await page.getByTestId("invite-claim-submit").click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /shift|today/i,
    );

    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    inviteeUserId =
      listed.data?.users.find((user) => user.email === inviteeEmail)?.id ??
      null;
    expect(inviteeUserId).toBeTruthy();

    const { data: membership, error: membershipError } = await admin
      .from("organization_memberships")
      .select(
        "id, role, all_properties, membership_property_grants!membership_property_grants_membership_id_fkey(property_id)",
      )
      .eq("user_id", inviteeUserId!)
      .eq("organization_id", GALAXY_ORG_ID)
      .single();
    expect(membershipError).toBeNull();
    expect(membership).toMatchObject({
      role: "manager",
      all_properties: false,
      membership_property_grants: [{ property_id: property.id }],
    });

    const { data: accepted } = await admin
      .from("organization_invitations")
      .select("accepted_at")
      .eq("id", invitationId)
      .single();
    expect(accepted?.accepted_at).toBeTruthy();
  });
});
