/**
 * CRELUNE — Shared Navigation Types
 */

export type NavModuleKey =
  | 'dashboard'
  | 'members'
  | 'birthdays'
  | 'designs'
  | 'templates'
  | 'assets'
  | 'events'
  | 'notifications'
  | 'settings';

export interface NavItem {
  key: NavModuleKey;
  label: string;
  href: string;
  icon: string;
  badge?: string;
  plannedMilestone?: string;
  description: string;
}
