import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";

import {
  PortalPageTitle,
  PortalSectionHeader,
} from "@/components/portal/portal-shell";
import styles from "@/components/portal/resident.module.css";
import {
  getPortalThread,
  type PortalThreadMessage,
} from "@/lib/portal/queries";
import { requirePortalSession } from "@/lib/portal/session";

export const metadata: Metadata = {
  title: "Messages — Odesa",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function PortalMessagesPage() {
  const session = await requirePortalSession();
  const { messages, textUsNumber } = await getPortalThread(session);
  const smsHref = textUsNumber ? `sms:${textUsNumber}` : null;

  return (
    <div data-testid="portal-messages-page">
      <PortalPageTitle
        eyebrow="Conversation"
        description="A tenant-visible record of texts between you and your property team."
      >
        Messages
      </PortalPageTitle>

      <div className={styles.content}>
        <section className={styles.section} aria-labelledby="message-history-title">
          <PortalSectionHeader>
            <span id="message-history-title">Message history</span>
          </PortalSectionHeader>

          {messages.length === 0 ? (
            <div className={styles.emptyState}>
              <h2>No messages yet</h2>
              <p>
                Texts sent through your property’s Odesa number will appear
                here when available.
              </p>
            </div>
          ) : (
            <ol className={styles.timeline}>
              {messages.map((message) => (
                <MessageEntry key={message.id} message={message} />
              ))}
            </ol>
          )}
        </section>

        {smsHref ? (
          <div className={styles.smsHandoff}>
            <p>Replies continue in your phone’s text app.</p>
            <a
              className={styles.button}
              href={smsHref}
              data-testid="portal-text-us"
            >
              <MessageCircle size={17} aria-hidden="true" />
              Text team
            </a>
          </div>
        ) : (
          <div className={styles.card}>
            <p className={styles.cardStrong}>Text messaging is not connected</p>
            <p>No property text number is available for this home.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageEntry({ message }: { message: PortalThreadMessage }) {
  return (
    <li className={styles.message}>
      <div className={styles.messageHeader}>
        <p className={styles.rowTitle}>
          {message.fromYou ? "You" : "Property team"}
        </p>
        <p className={styles.date}>{formatWhen(message.sentAt)}</p>
      </div>
      <p className={styles.messageBody}>{message.body}</p>
    </li>
  );
}
