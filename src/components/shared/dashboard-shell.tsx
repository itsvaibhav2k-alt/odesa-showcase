'use client';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="dot-grid-bg min-h-screen flex-1">
      {children}
    </div>
  );
}
