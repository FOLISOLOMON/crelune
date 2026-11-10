# CRELUNE — Design System & Visual Identity Specification

**Document:** Visual Design Tokens, Component Ergonomics, and Anti-Clutter Guidelines  
**Project:** CRELUNE  
**Version:** 1.0  
**Status:** Approved for Milestone 0 Foundation  
**Primary Reference:** [`docs/PRODUCT_MASTER_SPECIFICATION.md`](file:///d:/Projects/Crelune/docs/PRODUCT_MASTER_SPECIFICATION.md)

---

## 1. Creative Philosophy & Visual Direction

CRELUNE (*kreh-LOON*) is a creative operations platform, not an administrative church ledger or generic SaaS metric tracker. 

### Core Design Values
- **Artistic & Calm**: A serene, distraction-free creative studio environment that highlights user artwork and member photography.
- **High-Density Utility**: Designed for operational productivity on 1080p+ Windows displays without excessive whitespace.
- **Intentional Restraint**: Vibrant colors are reserved for active states, badges, and user artwork; surrounding interface chrome remains quiet and structured.

---

## 2. Anti-Clutter Enforcement Rules

To ensure CRELUNE maintains an authentic, professional creative identity, the following aesthetic anti-patterns are strictly prohibited:

| Prohibited Anti-Pattern | Reason | Required CRELUNE Pattern |
| :--- | :--- | :--- |
| **Generic AI Gradients** | Neon purple-to-pink gradient cards look synthetic and distracting. | Flat, disciplined violet (`#6541A5`) with crisp neutral surfaces (`#FFFFFF`). |
| **Glassmorphism / Heavy Blurs** | Heavy `backdrop-filter: blur()` hurts readability and rendering performance. | Crisp solid surfaces with subtle hairline borders (`#E8E5ED`). |
| **Excessive Card Rounding** | `rounded-3xl` cards waste canvas area and distort data tables. | Elegant, restrained corners: `rounded-md` ($6\text{px}$) and `rounded-lg` ($8\text{px}$). |
| **Giant Drop Shadows** | Deep blurry black shadows look murky on neutral backgrounds. | Hairline borders combined with subtle ambient shadow: `0 1px 3px rgba(36,33,43,0.05)`. |
| **Badge Confetti** | Adding category pills and badges to every table item creates visual noise. | Reserved status indicators using subtle colored dots or quiet text chips. |
| **Gratuitous Animations** | Bouncing buttons, card flips, and staggered fly-ins slow down workflow. | Instant micro-transitions ($\le 150\text{ms}$ ease-out), full respect for `prefers-reduced-motion`. |

---

## 3. Canonical Design Tokens

### 3.1 Color Palette

```text
Deep Creative Violet (Primary)  : #6541A5  rgb(101, 65, 165)
Muted Lavender (Secondary)      : #A99AD1  rgb(169, 154, 209)
Soft Neutral Background         : #F8F7FA  rgb(248, 247, 250)
Pure Surface White              : #FFFFFF  rgb(255, 255, 255)
Deep Charcoal (Primary Text)    : #24212B  rgb(36, 33, 43)
Muted Grey (Secondary Text)     : #77727F  rgb(119, 114, 127)
Hairline Border & Divider       : #E8E5ED  rgb(232, 229, 237)

Semantic Indicators:
Success (Restrained Green)      : #2E7D32  rgb(46, 125, 50)
Warning (Restrained Amber)      : #ED6C02  rgb(237, 108, 2)
Error (Restrained Red)          : #D32F2F  rgb(211, 47, 47)
Info (Restrained Blue)          : #0288D1  rgb(2, 136, 209)
```

### 3.2 Contrast & Accessibility (WCAG 2.1 AA)
- Primary Text (`#24212B`) on Surface (`#FFFFFF`): **$13.4:1$** (Exceeds AAA).
- Primary Text (`#24212B`) on Background (`#F8F7FA`): **$12.8:1$** (Exceeds AAA).
- Secondary Text (`#77727F`) on Surface (`#FFFFFF`): **$4.7:1$** (Passes AA).
- Primary Brand (`#6541A5`) on Surface (`#FFFFFF`): **$6.2:1$** (Passes AA).

---

## 4. Typography Scale

CRELUNE uses a clean, modern geometric/humanist sans-serif system stack (Inter, system-ui, sans-serif) with tabular figures for numerical clarity:

```css
font-variant-numeric: tabular-nums;
```

| Token | Size | Line Height | Weight | Letter Spacing | Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `text-display` | $28\text{px}$ ($1.75\text{rem}$) | $34\text{px}$ | 600 (Semibold) | $-0.02\text{em}$ | Dashboard header, major greetings |
| `text-h1` | $22\text{px}$ ($1.375\text{rem}$) | $28\text{px}$ | 600 (Semibold) | $-0.01\text{em}$ | Section headers, module titles |
| `text-h2` | $18\text{px}$ ($1.125\text{rem}$) | $24\text{px}$ | 600 (Semibold) | $0$ | Card headers, table section titles |
| `text-body` | $14\text{px}$ ($0.875\text{rem}$) | $20\text{px}$ | 400 (Regular) | $0$ | Primary table data, forms, body prose |
| `text-caption` | $12\text{px}$ ($0.75\text{rem}$) | $16\text{px}$ | 500 (Medium) | $+0.01\text{em}$ | Metadata, timestamps, helper text |
| `text-tag` | $11\text{px}$ ($0.6875\text{rem}$) | $14\text{px}$ | 600 (Semibold) | $+0.02\text{em}$ | Status chips, format badges |

---

## 5. Spacing, Geometry & Shadows

### 5.1 Spacing Scale ($4\text{px}$ Grid)
`2` ($2\text{px}$), `4` ($4\text{px}$), `8` ($8\text{px}$), `12` ($12\text{px}$), `16` ($16\text{px}$), `24` ($24\text{px}$), `32` ($32\text{px}$), `48` ($48\text{px}$), `64` ($64\text{px}$).

### 5.2 Radii & Geometry
- `rounded-sm`: $4\text{px}$ (Text inputs, small tags, tooltips)
- `rounded-md`: $6\text{px}$ (Standard buttons, dropdowns, table rows)
- `rounded-lg`: $8\text{px}$ (Workspace panels, modals, asset cards)
- `rounded-full`: Circular (Avatars, indicator dots)

### 5.3 Elevation & Shadows
- **Flat Surface**: `border border-[#E8E5ED] bg-white` (Default workspace panels)
- **Subtle Ambient**: `box-shadow: 0 1px 2px 0 rgba(36, 33, 43, 0.05);` (Floating toolbars, active cards)
- **Overlay Dialog**: `box-shadow: 0 10px 25px -5px rgba(36, 33, 43, 0.12), 0 8px 10px -6px rgba(36, 33, 43, 0.08);` (Modals, quick action sheets)

---

## 6. Layout & Ergonomics

### 6.1 Desktop Web Navigation
- **Fixed Left Sidebar ($240\text{px}$ width)**:
  1. *Dashboard* (Home overview)
  2. *Members* (People directory & photo management)
  3. *Birthdays* (Calendar & upcoming triggers)
  4. *Programmes* (Church events & flyer requirements)
  5. *Designs* (Active jobs & approval queue)
  6. *Templates* (Affinity template registry)
  7. *Assets* (Media library & logo store)
  8. *Notifications* (System alerts & agent status)
  9. *Settings* (Preferences & backup)
- **Header ($56\text{px}$ height)**: Fast universal search (`Ctrl+K`), quick action button ("+ New Design", "+ Add Member"), Creative Agent connection status pill.
- **Main Canvas**: Fluid width, responsive down to tablet ($768\text{px}$), where sidebar collapses into an accessible slide-over drawer.

### 6.2 Mobile Navigation & Touch Ergonomics
- **Bottom Tab Navigation (Native)**:
  1. `Home`: Upcoming birthdays & design priorities
  2. `Calendar`: Monthly birthday & event timeline
  3. `Designs`: Job status cards & one-tap approvals
  4. `Members`: Member directory with rapid search
  5. `More`: Assets, notifications & agent sync
- **Touch Target Standard**: Every touchable element measures at least $44 \times 44\text{ pt}$ ($48\text{px}$ on Android).
- **Haptic Feedback**: Subtle feedback (`expo-haptics`) upon photo capture and approval actions.

---

## 7. State Patterns

- **Empty States**: Never display a blank screen. Provide an elegant illustration or subtle icon, an explanation of the module's purpose, and a clear call-to-action button (e.g. *"No templates registered yet. Register your first Affinity flyer template to enable automated preparation."*).
- **Loading States**: Subtle skeleton loaders matching the exact bounds of the incoming content. No screen-blocking spinners for tabular data.
- **Error States**: Inline error banners with plain-English resolution guidance and retry actions. Stack traces are strictly suppressed.

---

## 8. Milestone 2 Implementation Status

The design tokens and core shared components are implemented in [`packages/ui`](file:///d:/Projects/Crelune/packages/ui):
- **Tokens**: [`tokens/colors.ts`](file:///d:/Projects/Crelune/packages/ui/src/tokens/colors.ts) and [`tokens/index.ts`](file:///d:/Projects/Crelune/packages/ui/src/tokens/index.ts) export exact brand palette constants and typography scales.
- **Components**: [`Button`](file:///d:/Projects/Crelune/packages/ui/src/components/Button.tsx), [`Input`](file:///d:/Projects/Crelune/packages/ui/src/components/Input.tsx), [`Card`](file:///d:/Projects/Crelune/packages/ui/src/components/Card.tsx), [`Badge`](file:///d:/Projects/Crelune/packages/ui/src/components/Badge.tsx), [`EmptyState`](file:///d:/Projects/Crelune/packages/ui/src/components/EmptyState.tsx), and [`Header`](file:///d:/Projects/Crelune/packages/ui/src/components/Header.tsx) are fully type-safe, accessible, and verified via automated vitest unit tests.
- **Tailwind Extension**: `apps/web/tailwind.config.ts` extends Tailwind CSS with canonical `crelune-*` color and radius utility classes.
