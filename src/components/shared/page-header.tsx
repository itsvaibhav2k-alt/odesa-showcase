import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Shared page header used at the top of every dashboard surface.
 *
 * Two shapes:
 *
 *   - Vertical "card-style" header (legacy): `eyebrow + title + description
 *     + actions`. Used by /properties, /settings, /assistant, AuthPanel,
 *     PageSection, etc. Same behaviour as before.
 *
 *   - Horizontal "topbar-style" header (inbox v4 + new pages): italic
 *     serif title, mono eyebrow + meta strip on the left, freshness /
 *     status indicator on the right. Activated by passing `meta` or
 *     `right`. Sticky to the top of the page, hairline bottom border,
 *     52px tall, `--canvas` background.
 *
 * The Today surface continues to use `<TodayTopbar />` directly — this
 * component mirrors that pattern so other pages can adopt it without
 * touching Today.
 */

type PageHeaderProps = {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  size?: 'page' | 'section';
  className?: string;
  /**
   * Optional meta strip rendered below (or beside) the title in the
   * topbar variant. When supplied alongside `metaTestId`, the meta
   * element receives that `data-testid` — used by /inbox to expose the
   * activity strip to e2e selectors.
   */
  meta?: React.ReactNode;
  /** `data-testid` applied to the meta element (topbar variant only). */
  metaTestId?: string;
  /** Right-aligned slot (e.g. live dot + freshness label). */
  right?: React.ReactNode;
};

function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  size = 'page',
  className,
  meta,
  metaTestId,
  right,
}: PageHeaderProps): React.ReactElement {
  // Topbar variant: any of meta / right opts in.
  if (meta !== undefined || right !== undefined) {
    return (
      <TopbarHeader
        eyebrow={eyebrow}
        title={title}
        meta={meta}
        metaTestId={metaTestId}
        right={right}
        className={className}
      />
    );
  }

  const TitleTag = size === 'page' ? 'h1' : 'h2';
  const titleClass =
    size === 'page'
      ? 'heading-1 font-serif-display'
      : 'heading-2 font-serif-display';

  const titleBlock = (
    <div className='flex flex-col gap-2'>
      {eyebrow ? <p className='meta-label'>{eyebrow}</p> : null}
      <TitleTag className={titleClass}>{title}</TitleTag>
      {description ? (
        <p className='body-text-sm max-w-[68ch]'>{description}</p>
      ) : null}
    </div>
  );

  const rootClass = actions
    ? 'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'
    : 'flex flex-col gap-2';

  if (actions) {
    return (
      <header data-slot='page-header' className={cn(rootClass, className)}>
        {titleBlock}
        <div className='flex items-center gap-2'>{actions}</div>
      </header>
    );
  }

  return (
    <header data-slot='page-header' className={cn(rootClass, className)}>
      {eyebrow ? <p className='meta-label'>{eyebrow}</p> : null}
      <TitleTag className={titleClass}>{title}</TitleTag>
      {description ? (
        <p className='body-text-sm max-w-[68ch]'>{description}</p>
      ) : null}
    </header>
  );
}

interface TopbarHeaderProps {
  eyebrow?: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  metaTestId?: string;
  right?: React.ReactNode;
  className?: string;
}

function TopbarHeader({
  eyebrow,
  title,
  meta,
  metaTestId,
  right,
  className,
}: TopbarHeaderProps): React.ReactElement {
  return (
    <header
      data-slot='page-header'
      data-variant='topbar'
      className={cn(
        'sticky top-0 z-30 flex items-center gap-5 px-6',
        'border-b',
        className,
      )}
      style={{
        minHeight: '52px',
        background: 'var(--canvas)',
        borderColor: 'var(--hairline-faint)',
      }}
    >
      <div className='flex items-baseline gap-3 min-w-0'>
        {eyebrow ? (
          <span
            className='uppercase tracking-[0.12em] text-[10.5px]'
            style={{
              fontFamily: 'var(--font-mono-operator)',
              color: 'var(--ink-3, #87796A)',
            }}
          >
            {eyebrow}
          </span>
        ) : null}
        <h1
          className='italic leading-none truncate'
          style={{
            fontFamily: 'var(--font-serif-display)',
            fontSize: '24px',
            letterSpacing: '-0.015em',
            color: 'var(--ink, #1B1712)',
          }}
        >
          {title}
        </h1>
      </div>

      {meta !== undefined ? (
        <div
          data-testid={metaTestId}
          className='flex items-center gap-2 text-[12px] min-w-0 truncate'
          style={{
            fontFamily: 'var(--font-mono-operator)',
            color: 'var(--ink-3, #87796A)',
          }}
        >
          {meta}
        </div>
      ) : null}

      {right !== undefined ? (
        <div
          className='ml-auto flex items-center gap-2 text-[11.5px] flex-shrink-0'
          style={{ color: 'var(--ink-3, #87796A)' }}
        >
          {right}
        </div>
      ) : null}
    </header>
  );
}

export { PageHeader };
export type { PageHeaderProps };
