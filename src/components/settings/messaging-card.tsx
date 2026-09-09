"use client";

/**
 * Messaging card — Settings → Integrations.
 *
 * Mirrors the onboarding messaging step so an operator who needs to
 * change their assistant name (or re-test the wiring) can do it after
 * onboarding without going back through the wizard.
 *
 * Three visible states:
 *   - assigned number (read-only) + JetBrains Mono caption
 *   - assistant name with inline edit (Save / Cancel)
 *   - "Send test SMS" button + result inline
 *
 * The card is purely interactive; data hydration happens in the
 * server component above (`/settings/integrations/page.tsx`).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  sendTestSmsAction,
  setAssistantNameAction,
} from "@/app/(dashboard)/onboarding/messaging/actions";
import {
  ASSISTANT_NAME_MAX_LENGTH,
  DEFAULT_ASSISTANT_NAME,
} from "@/app/(dashboard)/onboarding/messaging/constants";

interface MessagingCardProps {
  assignedNumber: string | null;
  assistantName: string;
  hasVerifiedPhone: boolean;
}

export function MessagingCard({
  assignedNumber,
  assistantName,
  hasVerifiedPhone,
}: MessagingCardProps) {
  const router = useRouter();

  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(assistantName);
  const [savedName, setSavedName] = useState(assistantName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, startSaveName] = useTransition();

  const [testStatus, setTestStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [sendingTest, startTest] = useTransition();

  const handleSaveName = () => {
    setNameError(null);
    startSaveName(async () => {
      const result = await setAssistantNameAction({ name: draftName });
      if (result.success) {
        setSavedName(result.data.assistantName);
        setDraftName(result.data.assistantName);
        setEditingName(false);
        router.refresh();
      } else {
        setNameError(result.error);
      }
    });
  };

  const handleCancelEdit = () => {
    setDraftName(savedName);
    setNameError(null);
    setEditingName(false);
  };

  const handleTestSms = () => {
    setTestStatus("idle");
    setTestMessage(null);
    const requestId = crypto.randomUUID();
    startTest(async () => {
      const result = await sendTestSmsAction(requestId);
      if (result.success) {
        setTestStatus("success");
        setTestMessage(
          `Provider accepted the test. Delivery to ${result.data.toE164} is pending.`,
        );
      } else {
        setTestStatus("error");
        setTestMessage(result.error);
      }
    });
  };

  const canTest = Boolean(assignedNumber) && hasVerifiedPhone;

  return (
    <section
      data-testid="messaging-card"
      aria-labelledby="messaging-card-heading"
      style={{
        background: "var(--paper-0)",
        border: "1px solid var(--ink-200)",
        borderRadius: "var(--radius-lg-odesa)",
        padding: "28px 32px",
        display: "flex",
        flexDirection: "column",
        gap: "24px",
      }}
    >
      <div>
        <p
          id="messaging-card-heading"
          className="meta-label"
          style={{ color: "var(--ink-500)" }}
        >
          Tenant messaging line
        </p>
        {assignedNumber ? (
          <p
            data-testid="messaging-card-number"
            className="tabular-nums mt-3"
            style={{
              fontFamily:
                "var(--font-mono-metrics), 'JetBrains Mono', monospace",
              fontWeight: 600,
              fontSize: "24px",
              lineHeight: 1.1,
              letterSpacing: "-0.01em",
              color: "var(--ink-900)",
            }}
          >
            {formatPhoneForDisplay(assignedNumber)}
          </p>
        ) : (
          <p
            data-testid="messaging-card-no-number"
            style={{
              fontSize: "14px",
              lineHeight: 1.55,
              color: "var(--ink-600)",
              marginTop: "12px",
              maxWidth: "52ch",
            }}
          >
            No number assigned yet. Finish onboarding to claim one from the
            shared pool.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="messaging-card-assistant-name">Assistant name</Label>
        {editingName ? (
          <div className="flex flex-col gap-2">
            <Input
              id="messaging-card-assistant-name"
              type="text"
              value={draftName}
              maxLength={ASSISTANT_NAME_MAX_LENGTH}
              onChange={(e) => {
                setDraftName(e.target.value);
                setNameError(null);
              }}
              placeholder={DEFAULT_ASSISTANT_NAME}
              data-testid="messaging-card-name-input"
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleSaveName}
                disabled={savingName || draftName.trim().length === 0}
                data-testid="messaging-card-name-save"
              >
                {savingName ? "Saving..." : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleCancelEdit}
                disabled={savingName}
                data-testid="messaging-card-name-cancel"
              >
                Cancel
              </Button>
            </div>
            {nameError && (
              <p
                className="text-sm text-destructive"
                role="alert"
                data-testid="messaging-card-name-error"
              >
                {nameError}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p
              data-testid="messaging-card-name-display"
              style={{
                fontSize: "15px",
                lineHeight: 1.4,
                color: "var(--ink-900)",
                fontWeight: 500,
              }}
            >
              {savedName}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditingName(true)}
              data-testid="messaging-card-name-edit"
            >
              Edit
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p
          style={{
            fontSize: "13px",
            lineHeight: 1.55,
            color: "var(--ink-600)",
            maxWidth: "60ch",
          }}
        >
          Send a one-off test message to your verified personal phone to confirm
          the wiring still works.
        </p>
        <div>
          <Button
            type="button"
            size="sm"
            onClick={handleTestSms}
            disabled={sendingTest || !canTest}
            data-testid="messaging-card-test-button"
          >
            {sendingTest ? "Sending..." : "Send test SMS"}
          </Button>
        </div>
        {!canTest && !testMessage && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="messaging-card-test-disabled"
          >
            {!assignedNumber
              ? "Assign a number first."
              : "Verify your personal phone above first."}
          </p>
        )}
        {testMessage && (
          <p
            className={
              testStatus === "success"
                ? "text-sm text-foreground"
                : "text-sm text-destructive"
            }
            role="status"
            data-testid={
              testStatus === "success"
                ? "messaging-card-test-success"
                : "messaging-card-test-error"
            }
          >
            {testMessage}
          </p>
        )}
      </div>
    </section>
  );
}

function formatPhoneForDisplay(raw: string): string {
  const match = raw.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (!match) return raw;
  return `+1 (${match[1]}) ${match[2]}-${match[3]}`;
}
