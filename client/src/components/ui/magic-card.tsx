import { ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

interface MagicCardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function MagicCard({ children, className, onClick }: MagicCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "relative overflow-hidden rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:shadow-md hover:border-brand-300 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-brand-700 cursor-pointer group",
        className
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-brand-500/0 via-brand-500/5 to-brand-500/0 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}