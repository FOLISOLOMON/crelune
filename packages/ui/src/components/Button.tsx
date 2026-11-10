import { forwardRef, type ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      disabled,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed select-none cursor-pointer';

    const sizeStyles = {
      sm: 'text-xs px-3 py-1.5 gap-1.5',
      md: 'text-sm px-4 py-2 gap-2',
      lg: 'text-base px-5 py-2.5 gap-2.5',
    }[size];

    const variantStyles = {
      primary:
        'bg-[#6541A5] text-white hover:bg-[#54348C] active:bg-[#452A74] focus:ring-[#6541A5] shadow-sm',
      secondary:
        'bg-[#EFEBF8] text-[#6541A5] hover:bg-[#EAE3F7] active:bg-[#D3CAEC] focus:ring-[#6541A5]',
      outline:
        'border border-[#E8E5ED] bg-white text-[#24212B] hover:bg-[#F8F7FA] active:bg-[#F3F2F6] focus:ring-[#6541A5]',
      ghost:
        'bg-transparent text-[#77727F] hover:text-[#24212B] hover:bg-[#F8F7FA] active:bg-[#F3F2F6] focus:ring-[#6541A5]',
      danger:
        'bg-[#DC2626] text-white hover:bg-[#B91C1C] active:bg-[#991B1B] focus:ring-[#DC2626] shadow-sm',
    }[variant];

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`}
        {...props}
      >
        {isLoading && (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
