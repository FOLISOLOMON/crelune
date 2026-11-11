/**
 * CRELUNE — Canonical Route Definitions
 */

import { NavItem } from '../types/navigation.js';

export const APP_ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  LOGOUT: '/logout',
  DASHBOARD: '/',
  MEMBERS: '/members',
  BIRTHDAYS: '/birthdays',
  DESIGNS: '/designs',
  TEMPLATES: '/templates',
  ASSETS: '/assets',
  EVENTS: '/events',
  NOTIFICATIONS: '/notifications',
  SETTINGS: '/settings',
} as const;

export const PUBLIC_ROUTES = [APP_ROUTES.LOGIN, APP_ROUTES.LOGOUT] as const;

export const NAVIGATION_ITEMS: readonly NavItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    href: APP_ROUTES.DASHBOARD,
    icon: 'layout-dashboard',
    description: 'Workspace overview, upcoming activity, and operations center',
  },
  {
    key: 'members',
    label: 'Members',
    href: APP_ROUTES.MEMBERS,
    icon: 'users',
    description: 'Member directory, contact details, and pastoral milestones',
  },
  {
    key: 'birthdays',
    label: 'Birthdays',
    href: APP_ROUTES.BIRTHDAYS,
    icon: 'cake',
    description: 'Birthday calendar, date-only records, and automated lead-time reminders',
  },
  {
    key: 'designs',
    label: 'Design Management',
    href: APP_ROUTES.DESIGNS,
    icon: 'palette',
    description: 'Creative job queue, status pipeline, and approval workflows',
  },
  {
    key: 'templates',
    label: 'Templates',
    href: APP_ROUTES.TEMPLATES,
    icon: 'file-text',
    badge: 'Milestone 5',
    plannedMilestone: 'Milestone 5',
    description: 'Affinity and PSD template catalog with layer field mappings',
  },
  {
    key: 'assets',
    label: 'Asset Library',
    href: APP_ROUTES.ASSETS,
    icon: 'folder-open',
    badge: 'Milestone 8',
    plannedMilestone: 'Milestone 8',
    description: 'Private media repository, photo storage, and typography assets',
  },
  {
    key: 'events',
    label: 'Events & Programmes',
    href: APP_ROUTES.EVENTS,
    icon: 'calendar',
    badge: 'Milestone 7',
    plannedMilestone: 'Milestone 7',
    description: 'Church event calendar, special programmes, and flyer links',
  },
  {
    key: 'notifications',
    label: 'Notifications',
    href: APP_ROUTES.NOTIFICATIONS,
    icon: 'bell',
    description: 'Reminder delivery history and channel alert preferences',
  },
  {
    key: 'settings',
    label: 'Settings',
    href: APP_ROUTES.SETTINGS,
    icon: 'settings',
    description: 'Workspace configuration, security credentials, and preferences',
  },
] as const;
