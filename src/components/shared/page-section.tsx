import * as React from 'react';

import { PageHeader } from '@/components/shared/page-header';
import { cn } from '@/lib/utils';

type PageSectionProps = {
  eyebrow?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'children' | 'title'>;

function PageSection({
  eyebrow,
  title,
  description,
  actions,
  className,
  children,
  ...rest
}: PageSectionProps): React.ReactElement {
  const showHeader = title !== undefined && title !== null;

  return (
    <section
      data-slot='page-section'
      className={cn('flex flex-col gap-6', className)}
      {...rest}
    >
      {showHeader ? (
        <PageHeader
          size='section'
          eyebrow={eyebrow}
          title={title}
          description={description}
          actions={actions}
        />
      ) : null}
      <div className='flex flex-col gap-4'>{children}</div>
    </section>
  );
}

export { PageSection };
export type { PageSectionProps };
