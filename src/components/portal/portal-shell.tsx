import type { ReactNode } from "react";
import { KeyRound } from "lucide-react";

import { PortalTabBar } from "./portal-tab-bar";
import styles from "./resident.module.css";

export function PortalShell({
  children,
  homeLabel,
}: {
  children: ReactNode;
  homeLabel: string | null;
}) {
  return (
    <div className={styles.portal} data-testid="portal-shell">
      <div className={styles.shell}>
        <div className={styles.stage}>
          <header className={styles.propertyHeader}>
            <div>
              <p className={styles.wordmark}>Odesa</p>
              <div className={styles.propertyIdentity}>
                <p className={styles.eyebrow}>Your home</p>
                <p className={styles.propertyName}>
                  {homeLabel ?? "Resident portal"}
                </p>
              </div>
            </div>
            <span className={styles.unitMark} aria-hidden="true">
              <KeyRound size={19} strokeWidth={1.8} />
            </span>
          </header>
          <main className={styles.main}>{children}</main>
          <PortalTabBar />
        </div>
      </div>
    </div>
  );
}

export function PortalPageTitle({
  children,
  eyebrow,
  description,
}: {
  children: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
      <h1 className={styles.display}>{children}</h1>
      {description ? <p>{description}</p> : null}
    </header>
  );
}

export function PortalSectionHeader({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.sectionHeader}>
      <h2 className={styles.sectionTitle}>{children}</h2>
      {action}
    </div>
  );
}

export { styles as residentStyles };
