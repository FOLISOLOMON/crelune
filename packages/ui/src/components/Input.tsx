import { forwardRef, type InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, id, className = '', disabled, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-medium text-[#24212B]"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          className={`w-full rounded-lg border px-3 py-2 text-sm text-[#24212B] bg-white placeholder-[#9B96A4] transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:bg-[#F8F7FA] disabled:text-[#9B96A4] disabled:cursor-not-allowed ${
            error
              ? 'border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20'
              : 'border-[#E8E5ED] focus:border-[#6541A5] focus:ring-[#6541A5]/20'
          } ${className}`}
          aria-invalid={Boolean(error)}
          aria-describedby={
            error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined
          }
          {...props}
        />
        {error && (
          <p id={`${inputId}-error`} className="text-xs text-[#DC2626] font-medium">
            {error}
          </p>
        )}
        {!error && helperText && (
          <p id={`${inputId}-helper`} className="text-xs text-[#77727F]">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
