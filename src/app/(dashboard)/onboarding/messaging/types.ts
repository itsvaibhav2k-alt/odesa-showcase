/**
 * Public Result-payload types for the Messaging onboarding step.
 *
 * Lives separately from `actions.ts` because that file is
 * `'use server'` and Next.js disallows non-function exports there.
 * Type-only re-exports are fine, but pulling these directly from a
 * dedicated file keeps the client bundle lean and avoids the
 * server-action graph being walked from a client import.
 */

export interface AssignNumberSuccess {
  e164: string;
}

export interface SetAssistantNameInput {
  name: string;
}

export interface SetAssistantNameSuccess {
  assistantName: string;
}

export interface SendTestSmsSuccess {
  providerMessageId: string;
  toE164: string;
}
