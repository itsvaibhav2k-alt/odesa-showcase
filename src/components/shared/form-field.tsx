import * as React from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type FormFieldProps = {
  label: string;
  htmlFor: string;
  description?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactNode;
};

function FormField({
  label,
  htmlFor,
  description,
  error,
  className,
  children,
}: FormFieldProps): React.ReactElement {
  const hasError = Boolean(error);

  return (
    <div
      data-slot='form-field'
      data-error={hasError ? 'true' : undefined}
      className={cn('flex flex-col gap-2', className)}
    >
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hasError ? (
        <p className='text-xs text-destructive' role='alert'>
          {error}
        </p>
      ) : description ? (
        <p className='text-xs text-muted-foreground'>{description}</p>
      ) : null}
    </div>
  );
}

export { FormField };
export type { FormFieldProps };
