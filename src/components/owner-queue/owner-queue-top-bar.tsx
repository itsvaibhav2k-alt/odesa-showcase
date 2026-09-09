/**
 * Owner Queue commitment-ledger top bar.
 *
 * Server component (no client interactivity). Reproduces the locked mockup's
 * `.global-bar`: a sticky page-chrome strip above the decision feed.
 *
 * Left ("page-mark"): a mono uppercase eyebrow ("Commitment ledger"), the page
 * title ("Owner Queue" in italic Instrument Serif), and a meta line summarizing
 * the queue — counts carry the `.num` class for tabular figures, separators are
 * muted middots.
 *
 * Right: a freshness dot + "Data current". When (and only when) a caller
 * supplies a real `checkedAgoLabel`, the strip adds that checked age —
 * we never fabricate a freshness figure (C14: no fake precision).
 *
 * All props are driven by the page's server-side data fetch so the counts
 * reflect the live queue on every render.
 */

export interface OwnerQueueTopBarProps {
  /** Pending decisions awaiting the owner. */
  pendingCount: number;
  /** Total dollars at stake across the queue, pre-formatted (e.g. "$4,090"). */
  totalAtStake: string;
  /** Count of time-sensitive decisions in the queue. */
  timeSensitiveCount: number;
  /**
   * Optional short "checked Nm ago" stamp, already including the unit ("11m",
   * "3h", "2d"). When supplied the bar adds the real checked age to its
   * "Data current" label; when omitted it does not fabricate a timestamp.
   */
  checkedAgoLabel?: string;
}

export function OwnerQueueTopBar({
  pendingCount,
  totalAtStake,
  timeSensitiveCount,
  checkedAgoLabel,
}: OwnerQueueTopBarProps) {
  return (
    <div
      data-testid="owner-queue-topbar"
      className="oq-topbar"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "52px",
        padding: "0 36px 0 18px",
        background: "var(--canvas)",
        borderBottom: "1px solid var(--hairline)",
      }}
    >
      <div
        className="oq-topbar-main"
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "12px",
        }}
      >
        <span
          className="oq-topbar-eyebrow"
          style={{
            fontFamily: "var(--font-mono-operator)",
            fontSize: "10px",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--ink-3)",
          }}
        >
          Commitment ledger
        </span>

        <h1
          className="oq-topbar-title"
          style={{
            fontFamily: "var(--font-serif-display)",
            fontStyle: "italic",
            fontSize: "22px",
            fontWeight: 400,
            letterSpacing: "-0.015em",
            lineHeight: 1,
            color: "var(--ink)",
          }}
        >
          Owner Queue
        </h1>

        <span
          className="oq-topbar-meta-desktop"
          style={{
            marginLeft: "6px",
            fontSize: "12.5px",
            color: "var(--ink-3)",
          }}
        >
          <span
            className="num"
            style={{ color: "var(--ink)", fontWeight: 450 }}
          >
            {pendingCount}
          </span>{" "}
          pending owner decisions
          <Separator />
          <span
            className="num"
            style={{ color: "var(--ink)", fontWeight: 450 }}
          >
            {totalAtStake}
          </span>{" "}
          at stake
          <Separator />
          <span
            className="num"
            style={{ color: "var(--ink)", fontWeight: 450 }}
          >
            {timeSensitiveCount}
          </span>{" "}
          time-sensitive
        </span>

        <span className="oq-topbar-meta-mobile">
          <span
            className="num"
            style={{ color: "var(--ink)", fontWeight: 450 }}
          >
            {pendingCount}
          </span>{" "}
          pending
          <Separator />
          <span
            className="num"
            style={{ color: "var(--ink)", fontWeight: 450 }}
          >
            {totalAtStake}
          </span>
        </span>
      </div>

      <div
        className="oq-topbar-live"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "11.5px",
          color: "var(--ink-3)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: "var(--green)",
            boxShadow: "0 0 0 3px rgba(77, 122, 86, 0.18)",
          }}
        />
        {checkedAgoLabel ? (
          <>
            Data current · checked{" "}
            <span style={{ fontFamily: "var(--font-mono-operator)" }}>
              {checkedAgoLabel}
            </span>{" "}
            ago
          </>
        ) : (
          "Data current"
        )}
      </div>

      <style
        precedence="default"
        href="owner-queue-topbar-responsive"
        dangerouslySetInnerHTML={{
          __html: `
.oq-topbar-meta-mobile { display: none; }
@media (max-width: 640px) {
  .oq-topbar { height: 52px !important; padding: 0 14px !important; }
  .oq-topbar-main { gap: 9px !important; min-width: 0; }
  .oq-topbar-eyebrow { display: none; }
  .oq-topbar-title { font-size: 19px !important; white-space: nowrap; }
  .oq-topbar-meta-desktop { display: none; }
  .oq-topbar-meta-mobile {
    display: inline-flex;
    align-items: baseline;
    white-space: nowrap;
    font-size: 11px;
    color: var(--ink-3);
  }
  .oq-topbar-live { font-size: 0 !important; gap: 0 !important; }
}
`,
        }}
      />
    </div>
  );
}

/** Muted middot separator between meta counts. */
function Separator() {
  return (
    <span aria-hidden="true" style={{ color: "var(--ink-4)", margin: "0 7px" }}>
      ·
    </span>
  );
}
