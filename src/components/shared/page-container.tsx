import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

const pageContainerVariants = cva(
  'flex flex-col w-full mx-auto px-[var(--page-padding-x)] ' +
    'pt-[var(--page-padding-y-top)] pb-[var(--page-padding-y-bottom)]',
  {
    variants: {
      width: {
        narrow: 'max-w-[var(--page-width-narrow)]',
        default: 'max-w-[var(--page-width-default)]',
        wide: 'max-w-[var(--page-width-wide)]',
      },
      density: {
        comfortable: 'gap-6',
        compact: 'gap-4',
      },
    },
    defaultVariants: {
      width: 'default',
      density: 'comfortable',
    },
  },
);

type PageContainerVariants = VariantProps<typeof pageContainerVariants>;

type PageContainerProps = {
  width?: NonNullable<PageContainerVariants['width']>;
  density?: NonNullable<PageContainerVariants['density']>;
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'children'>;

function PageContainer({
  width = 'default',
  density = 'comfortable',
  className,
  children,
  ...rest
}: PageContainerProps): React.ReactElement {
  return (
    <div
      data-slot="page-container"
      className={cn(pageContainerVariants({ width, density }), className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export { PageContainer, pageContainerVariants };
export type { PageContainerProps };
