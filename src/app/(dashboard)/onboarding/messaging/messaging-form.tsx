"use client";

/**
 * Client form for the Messaging onboarding step. Three sections:
 *
 *   1. Assigned number — read-only display once present, "Assign a
 *      number" button before that.
 *   2. Assistant name — inline form. Submits to setAssistantNameAction
 *      and reflects the saved value back so a refresh shows the truth.
 *   3. Test SMS — button that calls sendTestSmsAction and renders
 *      success/error inline.
 *
 * Server-action driven; uses optimistic local state for the assistant
 * name only so the input doesn't snap back while pending. Number
 * assignment + test SMS use plain `useTransition` for pending UX.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, PageSection } from "@/components/shared";
import type { ApiResponse } from "@/types";

import {
  ASSISTANT_NAME_MAX_LENGTH,
  DEFAULT_ASSISTANT_NAME,
  NO_AVAILABLE_NUMBERS_ERROR,
  NO_AVAILABLE_NUMBERS_MESSAGE,
} from "./constants";
import type {
  AssignNumberSuccess,
  SendTestSmsSuccess,
  SetAssistantNameInput,
  SetAssistantNameSuccess,
} from "./types";

interface MessagingFormProps {
  initialAssignedNumber: string | null;
  initialAssistantName: string;
  hasVerifiedPhone: boolean;
  /** Whether the operator can advance to /today; controlled by the page. */
  canFinish: boolean;
  assignNumber: () => Promise<ApiResponse<AssignNumberSuccess>>;
  setAssistantName: (
    input: SetAssistantNameInput,
  ) => Promise<ApiResponse<SetAssistantNameSuccess>>;
  sendTestSms: (requestId: string) => Promise<ApiResponse<SendTestSmsSuccess>>;
}

interface NameState {
  value: string;
  error: string | null;
  saved: boolean;
}

interface AssignState {
  number: string | null;
  error: string | null;
}

interface TestSmsState {
  status: "idle" | "success" | "error";
  message: string | null;
}

export function MessagingForm({
  initialAssignedNumber,
  initialAssistantName,
  hasVerifiedPhone,
  canFinish,
  assignNumber,
  setAssistantName,
  sendTestSms,
}: MessagingFormProps) {
  const router = useRouter();

  const [assignState, setAssignState] = useState<AssignState>({
    number: initialAssignedNumber,
    error: null,
  });
  const [nameState, setNameState] = useState<NameState>({
    value: initialAssistantName,
    error: null,
    saved: false,
  });
  const [testSmsState, setTestSmsState] = useState<TestSmsState>({
    status: "idle",
    message: null,
  });

  const [assigning, startAssign] = useTransition();
  const [savingName, startSaveName] = useTransition();
  const [sendingTest, startTest] = useTransition();

  const handleAssign = () => {
    setAssignState((prev) => ({ ...prev, error: null }));
    startAssign(async () => {
      const result = await assignNumber();
      if (result.success) {
        setAssignState({ number: result.data.e164, error: null });
        router.refresh();
      } else {
        const message =
          result.error === NO_AVAILABLE_NUMBERS_ERROR
            ? NO_AVAILABLE_NUMBERS_MESSAGE
            : result.error;
        setAssignState((prev) => ({ ...prev, error: message }));
      }
    });
  };

  const handleSaveName = () => {
    setNameState((prev) => ({ ...prev, error: null, saved: false }));
    startSaveName(async () => {
      const result = await setAssistantName({ name: nameState.value });
      if (result.success) {
        setNameState({
          value: result.data.assistantName,
          error: null,
          saved: true,
        });
      } else {
        setNameState((prev) => ({ ...prev, error: result.error }));
      }
    });
  };

  const handleTestSms = () => {
    setTestSmsState({ status: "idle", message: null });
    const requestId = crypto.randomUUID();
    startTest(async () => {
      const result = await sendTestSms(requestId);
      if (result.success) {
        setTestSmsState({
          status: "success",
          message: `Provider accepted the test. Delivery to ${result.data.toE164} is pending.`,
        });
      } else {
        setTestSmsState({ status: "error", message: result.error });
      }
    });
  };

  return (
    <div className="space-y-8" data-testid="messaging-form">
      <PageSection
        title="1. Your Odesa number"
        description="We assign one number from our shared pool to your org. Tenants call and text this number; calls and texts land in the same Odesa console."
        className="gap-3"
      >
        <div data-testid="messaging-section-number">
          {assignState.number ? (
            <p
              data-testid="messaging-assigned-number"
              className="tabular-nums text-base font-semibold"
            >
              {formatPhoneForDisplay(assignState.number)}
            </p>
          ) : (
            <Button
              type="button"
              onClick={handleAssign}
              disabled={assigning}
              data-testid="messaging-assign-button"
            >
              {assigning ? "Assigning..." : "Assign a number"}
            </Button>
          )}

          {assignState.error && (
            <p
              className="mt-2 text-sm text-destructive"
              role="alert"
              data-testid="messaging-assign-error"
            >
              {assignState.error}
            </p>
          )}
        </div>
      </PageSection>

      <PageSection
        title="2. What should the AI call itself?"
        description="Tenants will see this name when the assistant introduces itself. You can change it later in Settings."
        className="gap-3"
      >
        <div data-testid="messaging-section-name" className="space-y-3">
          <FormField label="Assistant name" htmlFor="assistantName">
            <Input
              id="assistantName"
              name="assistantName"
              type="text"
              placeholder={DEFAULT_ASSISTANT_NAME}
              value={nameState.value}
              maxLength={ASSISTANT_NAME_MAX_LENGTH}
              onChange={(e) =>
                setNameState({
                  value: e.target.value,
                  error: null,
                  saved: false,
                })
              }
              data-testid="messaging-name-input"
            />
          </FormField>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={handleSaveName}
              disabled={savingName || nameState.value.trim().length === 0}
              data-testid="messaging-name-save"
            >
              {savingName ? "Saving..." : "Save name"}
            </Button>
            {nameState.saved && (
              <span
                className="text-xs text-muted-foreground"
                data-testid="messaging-name-saved"
              >
                Saved
              </span>
            )}
          </div>
          {nameState.error && (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="messaging-name-error"
            >
              {nameState.error}
            </p>
          )}
        </div>
      </PageSection>

      <PageSection
        title="3. Verify with a test message"
        description={
          <>
            We&apos;ll text your verified personal phone from the assigned
            number to confirm the wiring.
          </>
        }
        className="gap-3"
      >
        <div data-testid="messaging-section-test" className="space-y-3">
          {!hasVerifiedPhone && (
            <p
              className="text-sm text-muted-foreground"
              data-testid="messaging-test-no-phone"
            >
              Verify your personal phone in{" "}
              <a
                href="/settings/integrations"
                className="underline underline-offset-4"
              >
                Settings &rarr; Integrations
              </a>{" "}
              first, then come back.
            </p>
          )}
          <Button
            type="button"
            onClick={handleTestSms}
            disabled={sendingTest || !hasVerifiedPhone || !assignState.number}
            data-testid="messaging-test-button"
          >
            {sendingTest ? "Sending..." : "Send test SMS"}
          </Button>
          {testSmsState.message && (
            <p
              className={
                testSmsState.status === "success"
                  ? "text-sm text-foreground"
                  : "text-sm text-destructive"
              }
              role="status"
              data-testid={
                testSmsState.status === "success"
                  ? "messaging-test-success"
                  : "messaging-test-error"
              }
            >
              {testSmsState.message}
            </p>
          )}
        </div>
      </PageSection>

      <div className="pt-2">
        <Button
          type="button"
          className="w-full"
          disabled={!canFinish}
          onClick={() => router.push("/onboarding/verify-phone")}
          data-testid="messaging-finish"
        >
          Continue to verify
        </Button>
        {!canFinish && (
          <p
            className="text-xs text-muted-foreground mt-2"
            data-testid="messaging-finish-hint"
          >
            Assign a number above to continue. Setting an assistant name and
            sending a test SMS are recommended but optional.
          </p>
        )}
      </div>
    </div>
  );
}

function formatPhoneForDisplay(raw: string): string {
  const match = raw.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (!match) return raw;
  return `+1 (${match[1]}) ${match[2]}-${match[3]}`;
}
