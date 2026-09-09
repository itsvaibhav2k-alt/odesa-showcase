import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: () => ({
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signInWithOAuth: mocks.signInWithOAuth,
      signUp: mocks.signUp,
    },
  }),
}));

import LoginPage from "../login/page";
import SignupPage from "../signup/page";

const TOKEN = "a".repeat(64);
const INVITE_PATH = `/invite/${TOKEN}`;

function setLocation(path: string) {
  window.history.replaceState({}, "", path);
}

beforeEach(() => {
  vi.resetAllMocks();
  setLocation("/");
  mocks.signInWithPassword.mockResolvedValue({ error: null });
  mocks.signInWithOAuth.mockResolvedValue({ error: null });
  mocks.signUp.mockResolvedValue({
    data: { session: { access_token: "test" } },
    error: null,
  });
});

describe("invitation auth navigation", () => {
  it("returns password login to a same-origin invitation path", async () => {
    setLocation(`/login?next=${encodeURIComponent(INVITE_PATH)}`);
    render(<LoginPage />);

    fireEvent.change(screen.getByTestId("login-email"), {
      target: { value: "invitee@example.test" },
    });
    fireEvent.change(screen.getByTestId("login-password"), {
      target: { value: "invite-secret" },
    });
    fireEvent.submit(screen.getByTestId("login-form"));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(INVITE_PATH));
  });

  it("preserves the invitation through the PKCE callback for Google login", async () => {
    setLocation(`/login?next=${encodeURIComponent(INVITE_PATH)}`);
    render(<LoginPage />);

    fireEvent.click(screen.getByTestId("login-google"));

    await waitFor(() => expect(mocks.signInWithOAuth).toHaveBeenCalledOnce());
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          INVITE_PATH,
        )}`,
      },
    });
  });

  it.each([
    "https://evil.example/invite/token",
    "//evil.example/invite/token",
    "/\\evil.example/invite/token",
    "javascript:alert(1)",
  ])("rejects unsafe login next value %s", async (unsafeNext) => {
    setLocation(`/login?next=${encodeURIComponent(unsafeNext)}`);
    render(<LoginPage />);

    fireEvent.change(screen.getByTestId("login-email"), {
      target: { value: "invitee@example.test" },
    });
    fireEvent.change(screen.getByTestId("login-password"), {
      target: { value: "invite-secret" },
    });
    fireEvent.submit(screen.getByTestId("login-form"));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/"));
  });

  it("creates an invitee without organization metadata and returns to explicit claim", async () => {
    setLocation(`/signup?invite=${TOKEN}`);
    render(<SignupPage />);

    await waitFor(() =>
      expect(
        screen.queryByTestId("signup-organization"),
      ).not.toBeInTheDocument(),
    );
    fireEvent.change(screen.getByTestId("signup-fullname"), {
      target: { value: "Fresh Invitee" },
    });
    fireEvent.change(screen.getByTestId("signup-email"), {
      target: { value: "invitee@example.test" },
    });
    fireEvent.change(screen.getByTestId("signup-password"), {
      target: { value: "invite-secret" },
    });
    fireEvent.submit(screen.getByTestId("signup-form"));

    await waitFor(() => expect(mocks.signUp).toHaveBeenCalledOnce());
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: "invitee@example.test",
      password: "invite-secret",
      options: {
        data: { full_name: "Fresh Invitee" },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          INVITE_PATH,
        )}`,
      },
    });
    expect(mocks.push).toHaveBeenCalledWith(INVITE_PATH);
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("fails closed for a malformed invite token instead of creating an organization", async () => {
    setLocation("/signup?invite=not-an-opaque-token");
    render(<SignupPage />);

    expect(await screen.findByTestId("signup-error")).toHaveTextContent(
      /invitation link is invalid/i,
    );
    expect(screen.queryByTestId("signup-organization")).not.toBeInTheDocument();
    expect(screen.getByTestId("signup-submit")).toBeDisabled();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });
});
