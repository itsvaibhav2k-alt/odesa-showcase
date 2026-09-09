"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CreditCard,
  FileText,
  Home,
  MessageCircle,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import styles from "./resident.module.css";

interface PortalTab {
  href: string;
  label: string;
  icon: LucideIcon;
  testId: string;
}

const TABS: PortalTab[] = [
  { href: "/portal", label: "Home", icon: Home, testId: "portal-tab-home" },
  {
    href: "/portal/payments",
    label: "Payments",
    icon: CreditCard,
    testId: "portal-tab-payments",
  },
  {
    href: "/portal/maintenance",
    label: "Maintenance",
    icon: Wrench,
    testId: "portal-tab-maintenance",
  },
  {
    href: "/portal/messages",
    label: "Messages",
    icon: MessageCircle,
    testId: "portal-tab-messages",
  },
  {
    href: "/portal/lease",
    label: "Lease",
    icon: FileText,
    testId: "portal-tab-lease",
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/portal") return pathname === "/portal";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalTabBar() {
  const pathname = usePathname();

  return (
    <nav className={styles.tabs} aria-label="Resident portal">
      {TABS.map(({ href, label, icon: Icon, testId }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            data-testid={testId}
            aria-current={active ? "page" : undefined}
            className={`${styles.tab} ${active ? styles.tabActive : ""}`}
          >
            <Icon
              className={styles.tabIcon}
              size={19}
              strokeWidth={active ? 2.2 : 1.8}
              aria-hidden="true"
            />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
