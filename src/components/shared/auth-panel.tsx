import * as React from 'react';

import { cn } from '@/lib/utils';

type AuthPanelProps = {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

function AuthPanel({ eyebrow, title, description, footer, className, children }: AuthPanelProps): React.ReactElement {
  return (
    <article data-slot="auth-panel" className={cn('auth-panel w-full max-w-xl mx-auto', className)}>
      <header className="auth-panel__header">
        {eyebrow ? <p className="auth-panel__eyebrow meta-label">{eyebrow}</p> : null}
        <h2 className="auth-panel__title">{title}</h2>
        {description ? <p className="auth-panel__description">{description}</p> : null}
      </header>
      <div className="auth-panel__content">{children}</div>
      {footer ? (
        <footer data-slot="card-footer" className="auth-panel__footer flex">
          {footer}
        </footer>
      ) : null}
    </article>
  );
}

export { AuthPanel };
export type { AuthPanelProps };
