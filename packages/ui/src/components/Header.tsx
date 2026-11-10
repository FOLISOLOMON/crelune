import type { ReactNode } from 'react';

export interface HeaderProps {
  title: string;
  description?: string;
  badge?: ReactNode;
  actions?: ReactNode;
}

export function Header({ title, description, badge, actions }: HeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-[#E8E5ED]">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#24212B]">
            {title}
          </h1>
          {badge}
        </div>
        {description && (
          <p className="mt-1 text-xs sm:text-sm text-[#77727F]">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2.5">{actions}</div>}
    </div>
  );
}
