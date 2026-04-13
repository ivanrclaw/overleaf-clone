import { ReactNode } from 'react';

interface AnimatedGradientTextProps {
  children: ReactNode;
  className?: string;
}

export function AnimatedGradientText({ children, className = '' }: AnimatedGradientTextProps) {
  return (
    <span className={`inline-block bg-gradient-to-r from-brand-600 via-purple-500 to-brand-500 bg-clip-text text-transparent animate-gradient bg-[length:200%_200%] ${className}`}>
      {children}
    </span>
  );
}