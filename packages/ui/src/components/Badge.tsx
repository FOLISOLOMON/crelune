import type { HTMLAttributes } from 'react';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info';
  size?: 'sm' | 'md';
}

export function Badge({
  variant = 'default',
  size = 'md',
  className = '',
  children,
  ...props
}: BadgeProps) {
  const sizeStyles = {
    sm: 'text-[11px] px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
  }[size];

  const variantStyles = {
    default: 'bg-[#F3F2F6] text-[#77727F] border border-[#E8E5ED]',
    primary: 'bg-[#EFEBF8] text-[#6541A5] border border-[#D3CAEC]',
    success: 'bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]',
    warning: 'bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A]',
    error: 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]',
    info: 'bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]',
  }[variant];

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${sizeStyles} ${variantStyles} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
