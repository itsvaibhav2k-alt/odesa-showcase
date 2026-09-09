import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: { label: string; href: string };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div
      data-testid="empty-state"
      className="flex flex-col items-center justify-center py-16 text-center"
    >
      {icon && (
        <div className="mb-4 text-muted-foreground [&_svg]:size-10">
          {icon}
        </div>
      )}
      <h3
        className="heading-4 text-foreground"
      >
        {title}
      </h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        {description}
      </p>
      {action && (
        <Link href={action.href} className="mt-6">
          <Button data-testid="empty-state-action">{action.label}</Button>
        </Link>
      )}
    </div>
  );
}
