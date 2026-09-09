"use client";

/**
 * CaseTimeline — replaces the chat-bubble ThreadBody.
 *
 * Each event is a 3-column grid: time / marker dot / body line.
 * Marker dot color is keyed off direction + draft_status so the
 * operator's eye can scan who-said-what at a glance:
 *
 *   - inbound                                    → --ink   (tenant)
 *   - outbound + draftStatus='auto_sent'         → --terracotta (Odesa)
 *   - outbound + draftStatus='sent_by_human'     → --ink-2 (you)
 *   - outbound from a vendor channel (future)    → --gold (treated as Odesa for now)
 *
 * A connector hairline runs between events so the timeline reads as
 * one continuous record.
 */

import type { ThreadMessage } from "@/lib/inbox/conversation-queries";

export interface CaseTimelineProps {
  messages: readonly ThreadMessage[];
  /**
   * True when a pending-review draft exists for this conversation (it
   * renders in the hero above, not here). The empty copy must then be
   * explicit that the draft has NOT been sent — trust requirement.
   */
  hasPendingDraft?: boolean;
}

export function CaseTimeline({
  messages,
  hasPendingDraft = false,
}: CaseTimelineProps) {
  // Filter out the pending draft — it renders in the hero, not the
  // timeline.
  const visible = messages.filter((m) => m.draftStatus !== "pending_review");

  if (visible.length === 0) {
    return (
      <div
        data-testid="inbox-thread-body"
        className="px-9 py-6"
        style={{
          color: "var(--ink-3, #87796A)",
          fontFamily: "var(--font-mono-operator, ui-monospace, monospace)",
          fontSize: "11px",
          letterSpacing: "0.06em",
          textAlign: "center",
        }}
      >
        {hasPendingDraft
          ? "DRAFT PENDING — NOT SENT. NO TENANT MESSAGES YET."
          : "NO SENT TENANT MESSAGES YET"}
      </div>
    );
  }

  return (
    <ol
      role="list"
      data-testid="inbox-thread-body"
      className="flex flex-col px-9 py-2"
      style={{ gap: 0 }}
    >
      {visible.map((msg, idx) => (
        <TimelineEntry
          key={msg.id}
          message={msg}
          isLast={idx === visible.length - 1}
        />
      ))}
    </ol>
  );
}

interface TimelineEntryProps {
  message: ThreadMessage;
  isLast: boolean;
}

function TimelineEntry({ message, isLast }: TimelineEntryProps) {
  const tone = markerTone(message);
  const actor = actorLabel(message);

  return (
    <li
      className="relative"
      style={{
        display: "grid",
        gridTemplateColumns: "64px 24px 1fr",
        gap: "0px",
        paddingTop: "12px",
        paddingBottom: "12px",
      }}
    >
      <div
        className="num uppercase"
        style={{
          fontFamily: "var(--font-mono-operator, ui-monospace, monospace)",
          fontSize: "10px",
          color: "var(--ink-4, #9F9075)",
          letterSpacing: "0.08em",
          paddingTop: "3px",
          textAlign: "right",
          paddingRight: "12px",
          fontFeatureSettings: '"tnum" 1',
        }}
      >
        {formatTimeLabel(message.createdAt)}
      </div>
      <div
        className="relative flex justify-center"
        style={{ paddingTop: "6px" }}
        aria-hidden="true"
      >
        <span
          style={{
            display: "inline-block",
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: tone,
            flexShrink: 0,
            position: "relative",
            zIndex: 1,
          }}
        />
        {!isLast ? (
          <span
            style={{
              position: "absolute",
              top: "14px",
              bottom: "-12px",
              left: "50%",
              width: "1px",
              background: "var(--hairline-faint, #EAE0CA)",
              transform: "translateX(-0.5px)",
            }}
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-1 min-w-0">
        <span
          className="uppercase"
          style={{
            fontFamily: "var(--font-mono-operator, ui-monospace, monospace)",
            fontSize: "9.5px",
            letterSpacing: "0.12em",
            color: "var(--ink-4, #9F9075)",
          }}
        >
          {actor}
          {message.direction === "outbound"
            ? ` · ${deliveryLabel(message.deliveryStatus)}`
            : ""}
        </span>
        <p
          className="m-0 break-words"
          style={{
            fontFamily: "var(--font-sans-operator, system-ui, sans-serif)",
            fontSize: "13.5px",
            lineHeight: 1.55,
            color: "var(--ink, #1B1712)",
          }}
        >
          {message.body}
        </p>
      </div>
    </li>
  );
}

function deliveryLabel(status: ThreadMessage["deliveryStatus"]): string {
  switch (status) {
    case "provider_accepted":
      return "Provider accepted";
    case "delivered":
      return "Delivered";
    case "undelivered":
      return "Undelivered";
    case "failed":
      return "Failed";
    case "suppressed":
      return "Suppressed";
    case "queued":
      return "Queued";
    case "approved":
      return "Approved";
    default:
      return "Draft";
  }
}

function markerTone(msg: ThreadMessage): string {
  if (msg.direction === "inbound") return "var(--ink, #1B1712)";
  if (msg.draftStatus === "auto_sent") return "var(--terracotta, #B85731)";
  if (msg.draftStatus === "sent_by_human") return "var(--ink-2, #56493A)";
  // 'sending' = send in flight (or awaiting reconciliation): neutral.
  if (msg.draftStatus === "sending") return "var(--ink-4, #9F9075)";
  return "var(--terracotta, #B85731)";
}

function actorLabel(msg: ThreadMessage): string {
  if (msg.direction === "inbound") return "Tenant";
  if (msg.draftStatus === "auto_sent") return "Odesa";
  if (msg.draftStatus === "sent_by_human") return "You";
  if (msg.draftStatus === "sending") return "Odesa · Sending";
  return "Odesa";
}

function formatTimeLabel(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\s?[AP]M$/i, (m) => m.trim().toLowerCase());
}
