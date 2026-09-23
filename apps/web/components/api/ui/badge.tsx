import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../../../lib/cn';

export const badgeVariants = cva('font-mono font-medium', {
  variants: {
    color: {
      // Direction A: one accent, used for the method that writes (POST, the
      // only one today); the rest are muted text rather than a rainbow.
      green: 'text-text-muted',
      yellow: 'text-text-muted',
      red: 'text-bad-text',
      blue: 'text-accent-text',
      orange: 'text-text-muted',
      gray: 'text-fd-muted-foreground',
    },
  },
});

export type BadgeColor = NonNullable<VariantProps<typeof badgeVariants>['color']>;

export function Badge({
  className,
  color,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, 'color'> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ color }), className)} {...props}>
      {props.children}
    </span>
  );
}
