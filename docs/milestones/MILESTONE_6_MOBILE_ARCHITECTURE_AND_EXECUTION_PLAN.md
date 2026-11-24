# CRELUNE — Milestone 6: Mobile Application
## Phase 0 — Architecture Validation & Implementation Plan

**Milestone:** 6 — CRELUNE Mobile Application (`apps/mobile`)  
**Phase:** Phase 0 — Architecture Validation & Execution Planning *(Planning Only — Implementation Not Started)*  
**Repository:** `FOLISOLOMON/crelune` (`D:\Projects\Crelune`)  
**Branch / Approved Baseline:** `main` @ `f9b1b5a63eeab2310098e53caf6c215e7d516ca9`  
**Date:** 2026-11-23  
**Authoritative References:** [`PRODUCT_MASTER_SPECIFICATION.md`](file:///d:/Projects/Crelune/docs/PRODUCT_MASTER_SPECIFICATION.md), [`ARCHITECTURE.md`](file:///d:/Projects/Crelune/docs/ARCHITECTURE.md), [`DATABASE_DESIGN.md`](file:///d:/Projects/Crelune/docs/DATABASE_DESIGN.md), [`DESIGN_SYSTEM.md`](file:///d:/Projects/Crelune/docs/DESIGN_SYSTEM.md), [`SECURITY.md`](file:///d:/Projects/Crelune/docs/SECURITY.md), [`TECHNICAL_DECISIONS.md`](file:///d:/Projects/Crelune/docs/TECHNICAL_DECISIONS.md), [`TESTING_STRATEGY.md`](file:///d:/Projects/Crelune/docs/TESTING_STRATEGY.md), [`.agents/AGENTS.md`](file:///d:/Projects/Crelune/.agents/AGENTS.md)

---

## 1. Decision Classification Matrix (Approved vs. Verified vs. Proposed vs. External & Blockers)

### 1.1 Approved Product Decisions (Confirmed by Product Owner)
1. **Dual-Platform First Release (Mandatory):** CRELUNE Mobile MUST support **both Android and iOS** from its first release. Do not introduce Android-only libraries, native modules, or platform assumptions; maintain iOS configuration and build compatibility throughout all stages.
2. **Android-First Development & Verification Priority:** Prioritize **Android emulator** (`Medium_Phone_API_37.0`, `Small_Phone`) and **physical Android device** verification for camera capture, image normalization, uploads, push notifications, authentication, and navigation throughout Milestone 6 development.
3. **iOS Physical-Device Testing Gate:** The Product Owner does **not** currently have an iPhone. Physical iOS runtime, camera/HEIC, APNs push, and TestFlight acceptance are explicitly marked **`PENDING / BLOCKED (No Physical iPhone Available)`**. **EAS cloud builds alone NEVER count as physical-device verification**, and real iPhone testing is a mandatory gate before public release.
4. **Expo / EAS Account:** The Product Owner has an **existing Expo account** to use for EAS project configuration and cloud builds (do **not** assume paid EAS plans or preconfigured signing/push credentials).
5. **Genuinely Native Experience (ADR 006):** Build native UI components with React Native + Expo + TypeScript + Expo Router. **Zero WebView wrappers** around CRELUNE Web.
6. **Single Shared Backend:** CRELUNE Mobile MUST communicate exclusively with the existing CRELUNE Next.js backend (`apps/web/src/app/api/*`). No second backend service and no direct PostgreSQL or S3 credential exposure in the mobile bundle.
7. **Hosting Architecture:** **Vercel** is approved as the intended CRELUNE Web/API hosting platform; **Neon** remains the PostgreSQL database and private object storage provider. Deployment settings and scheduled cron execution (`POST /api/cron/birthday-reminders`) must be validated on development/staging before any production changes.
8. **Planned Initial Distribution Channels:** **Google Play Internal Testing** (Android) and **Apple TestFlight Internal Testing** (iOS) are the planned initial single-owner distribution channels.
9. **Single-Owner Scope (ADR 003) & Milestone 5 Preservation:** Owner-only auth with zero public registration; all existing Web, Database, Storage, and Windows Creative Agent functionality preserved with zero regressions.

### 1.2 Verified Workstation Capabilities (Empirically Checked `2026-11-23`)
- **Host OS:** Windows 11 (supports local Android native builds & emulators; **no Xcode / no local iOS Simulator**).
- **Monorepo Runtime:** Node `v24.21.0`, npm `11.19.0`, `react@19.3.1`, `next@15.5.29`, `zod@4.6.7`.
- **Android Local Toolchain:** Eclipse Adoptium JDK `21.0.13.9`, `ANDROID_HOME = C:\Users\Foli Solomon\AppData\Local\Android\Sdk`, `adb`, `cmdline-tools/latest`, `build-tools 36.0.0 & 37.0.0`, `platforms/android-37.0`, `emulator.exe`, x86_64 Google APIs Play Store image, and AVDs `Medium_Phone_API_37.0` and `Small_Phone` (`0` physical USB devices attached at audit time).
- **NPM Registry Compatibility:** Expo **SDK 58** (`expo@58.0.26`, `expo-router@58.0.32`, `react-native@0.88.1`, New Architecture) requires `react@^19.3.0` — matches installed `react@19.3.1` with zero React version split.
- **Shared Packages:** `@crelune/shared` contains zero Node built-ins; `@crelune/ui` root exports web DOM components and CSS-unit tokens (requiring a pure hex-color subpath export `@crelune/ui/colors`).

### 1.3 Proposed Implementation Details (Awaiting Product Owner Approval Before Stage 6.1)
1. **Mobile SDK Pinning:** Expo SDK 58 (`expo@58.0.26`), React Native `0.88.1` (New Architecture), Expo Router v7 (`expo-router@58.0.32`), Continuous Native Generation (CNG) + `expo-dev-client`.
2. **Mobile Authentication (Decision D):** Per-device `MobileDevice` + rotating `MobileSession` refresh tokens (`30d` TTL, SHA-256 hashed in PostgreSQL, family replay revocation) + short-lived signed mobile access tokens (`15m` TTL, `typ: 'mobile_access'`) stored in `expo-secure-store` (iOS Keychain / Android Keystore), integrated into `middleware.ts` and `requireAuthenticatedOwnerApi` without weakening Web Cookie + CSRF protection.
3. **Push Notification Stack (Decision B):** **Expo Push Notification Service** backed by **FCM v1** (Android) and **APNs `.p8`** (iOS) with a durable PostgreSQL `PushDelivery` outbox (`UNIQUE(notificationId, mobileDeviceId)`) decoupled from `processDueBirthdayReminders()` transactions.
4. **Milestone 7 / 8 Scope Boundary:** Keep `Calendar` focused on live Birthday Operations and render truthful Roadmap status cards for **Events & Programmes (Milestone 7)** and **Asset Library (Milestone 8)** rather than pulling Milestone 7/8 schemas prematurely into Milestone 6.
5. **App Identifiers & Deep-Link Schemes:** Working identifiers `com.crelune.app` / `com.crelune.app.dev` / `com.crelune.app.preview` and schemes `crelune://` / `crelune-dev://` / `crelune-preview://` (subject to founder-owned domain confirmation before public release).

### 1.4 External Dependencies Still Awaiting Confirmation (Never Assumed)
- **Apple Developer Program account (\$99/year):** **UNCONFIRMED.**
- **Google Play Console developer account (\$25 one-time):** **UNCONFIRMED.**
- **Firebase project (free Spark tier — required for Android FCM v1 `google-services.json` & Service Account Key):** **UNCONFIRMED.**
- **Expo / EAS plan tier & credentials:** Existing Expo account confirmed; do **not** assume paid EAS concurrency/build quotas or preconfigured signing/push credentials.
- **Vercel deployment & Cron setup:** Vercel approved as hosting target; exact Vercel project, environment variables, preview/staging URL, and Vercel Cron (or external cron trigger) schedule/tier limits remain to be validated before production changes.
- **Physical Android device:** Confirm availability for physical camera, upload, and FCM push verification alongside the local Android emulators.

### 1.5 Explicit Release Blockers (Unavailable Devices & Unconfirmed Accounts)
1. **Unavailable Physical iPhone (Hard Public-Release Blocker):** Physical iOS runtime, native camera/HEIC capture, APNs push delivery, VoiceOver/Dynamic Type, and TestFlight verification are **blocked / pending** until a physical iPhone is available. **EAS cloud iOS builds confirm compilation/signing config only — they never substitute for physical iPhone testing.**
2. **Unconfirmed Apple Developer Program Account (Hard iOS Signing/TestFlight/APNs Blocker):** Blocks iOS Ad-Hoc/TestFlight EAS builds, APNs `.p8` push key setup, and TestFlight Internal Testing distribution.
3. **Unconfirmed Google Play Console Account (Play Internal Testing Blocker):** Blocks uploading `.aab` releases to Google Play Internal Testing (does **not** block local Android emulator or sideloaded APK development verification).
4. **Unconfirmed Firebase Project (Android Remote Push Blocker):** Blocks real FCM v1 remote push notification delivery on Android in Stages 6.6–6.7 (does **not** block Stages 6.1–6.5).

---

## 2. Empirical Audit of Existing System & Workstation Environment

### 2.1 Development Workstation & Toolchain Audit (`Windows 11`, verified `2026-11-23`)

| Tool / Component | Audited Status | Architectural Impact |
|---|---|---|
| **OS** | Windows 11 | Can run Android local builds & emulator; **cannot run Xcode or iOS Simulator locally**. |
| **Node.js / npm** | `v24.21.0` / `11.19.0` (npm workspaces) | Compatible with Expo SDK 58 and existing monorepo scripts. |
| **Installed React / Next / Zod** | `react@19.3.1`, `next@15.5.29`, `zod@4.6.7` | **Verified compatible:** `react-native@0.88.1` requires `react@^19.3.0` and `@types/react@^19.1.1` — **no React version split** in the monorepo. |
| **Java JDK** | Eclipse Adoptium JDK `21.0.13.9` | Ready for Android Gradle builds. |
| **Android SDK** | `ANDROID_HOME = C:\Users\Foli Solomon\AppData\Local\Android\Sdk` (`adb`, `cmdline-tools/latest`, `build-tools 36.0.0 & 37.0.0`, `platforms/android-37.0`, `emulator.exe`, x86_64 Google APIs Play Store image) | Local Android native builds and emulator runs are feasible directly on this machine. Note: React Native / Expo SDK 58 may also require `platforms/android-35` or `android-36` depending on Gradle `compileSdkVersion` — verify via `npx expo-doctor` in Stage 6.1. |
| **Android AVDs** | `Medium_Phone_API_37.0`, `Small_Phone` (`0` physical USB devices currently attached) | Two local emulators exist for responsive phone testing; physical Android device still required for real camera + FCM push verification. |
| **Expo / EAS CLI** | Not installed globally (`expo: NOT FOUND`, `eas: NOT FOUND`) | Install workspace-scoped in `apps/mobile` (`npx expo`, `npx eas-cli`). |
| **Xcode / macOS** | `xcodebuild: NOT FOUND` (Windows 11) | **EAS Build cloud macOS runners** (or an external macOS host) are strictly mandatory for iOS dev/TestFlight/App Store builds. |

### 2.2 Existing Backend, Schema & API Audit (Verified from Source)

| Subsystem | Inspected Source Files | Reuse Status for Mobile | Required Gap / Change |
|---|---|---|---|
| **Authentication & Edge Middleware** | [`middleware.ts`](file:///d:/Projects/Crelune/apps/web/src/middleware.ts), [`session.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/session.ts), [`owner-guard.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/owner-guard.ts), [`api-owner-guard.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/api-owner-guard.ts), [`csrf.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/csrf.ts) | **Cannot reuse cookie-only flow as-is.** Middleware only reads `crelune_session` cookie; all mutating APIs enforce browser `Origin`/`Referer` CSRF checks. | Add mobile Bearer access-token verification in `middleware.ts` & `api-owner-guard.ts`, preserving strict CSRF for cookie requests while bypassing CSRF only for pure Bearer mobile requests; add `/api/mobile/auth/{login,refresh,logout}` and `/api/mobile/devices/*`. |
| **Password & Login Throttling** | [`password.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/password.ts), [`rate-limit.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/rate-limit.ts), [`login/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/auth/login/route.ts) | **100% reusable.** `scrypt` verification, constant-time dummy hash, and PostgreSQL `AuthThrottle` (`ip:` + `ip_acct:` / `acct_noip:`) already exist. | Extract shared credential-verification + throttle helper so web login and `POST /api/mobile/auth/login` share one single authoritative path. |
| **Dashboard Aggregation** | [`dashboard-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/dashboard/dashboard-service.ts), [`(dashboard)/page.tsx`](file:///d:/Projects/Crelune/apps/web/src/app/(dashboard)/page.tsx) | **Service 100% reusable**, but currently SSR-only (no HTTP route). | Expose `GET /api/dashboard` wrapping `getDashboardSnapshot(orgId, userId)` so mobile `Home` loads in one round-trip. |
| **Members Directory & CRUD** | [`api/members/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/members/route.ts), `api/members/[id]/{route,archive,restore}`, [`member-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/members/member-service.ts) | **100% reusable** once `requireAuthenticatedOwnerApi` accepts mobile Bearer auth. | None to business logic; verify mobile `POST /api/members` supports fast `<30s` creation and optional immediate photo upload. |
| **Member Photos (Private S3 + `sharp`)** | [`api/members/[id]/photo/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/members/[id]/photo/route.ts), [`image-processor.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/storage/image-processor.ts) | **Backend 100% reusable** (`GET`/`POST`/`DELETE`, bounded 10 MB multipart `file`, EXIF/GPS stripping, `Cache-Control: private, no-store`). | **Critical mobile requirement:** backend accepts ONLY `image/jpeg`, `image/png`, `image/webp` (`<= 10 MB`, `<= 8000x8000`, single-frame). Mobile MUST transcode iOS **HEIC/HEIF** and downscale large camera captures to JPEG (`<= 2048px`) via `expo-image-manipulator` before multipart upload. Private image rendering uses authenticated `Authorization: Bearer` headers (`expo-image`, memory-only cache). |
| **Birthdays & Preferences** | [`api/birthdays/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/birthdays/route.ts), `api/birthdays/sync`, `api/birthdays/[memberId]/[targetYear]/status`, [`api/settings/birthdays/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/settings/birthdays/route.ts) | **100% reusable.** Date-only civil arithmetic, leap-day policies (`FEB_28`/`MAR_1`), and reminder preferences already live in backend + `@crelune/shared`. | Extend preferences schema/endpoint (or add `PATCH /api/settings/notifications`) for mobile push notification opt-in toggles. |
| **Notifications & Reminder Engine** | [`api/notifications/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/notifications/route.ts), `api/notifications/[id]/read`, `read-all`, [`birthday-processor-service.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/birthdays/birthday-processor-service.ts), [`api/cron/birthday-reminders/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/cron/birthday-reminders/route.ts) | **In-app notifications & deduped reminder engine 100% reusable.** | Currently creates **in-app `Notification` rows only**; no push token table (`DeviceRegistration` in `DATABASE_DESIGN.md` is NOT in `schema.prisma` yet) and no push dispatcher. Add `MobileDevice` push token registration + decoupled `PushDelivery` outbox + Expo Push dispatcher triggered after reminder/event notifications commit. |
| **Design Management & Exports** | [`api/designs/route.ts`](file:///d:/Projects/Crelune/apps/web/src/app/api/designs/route.ts), `api/designs/[id]/{route,transition,preparation}`, `api/designs/[id]/exports/[exportId]/{file,approval}` | **100% reusable.** Full 8-status pipeline, explicit `EXPORTED` vs `PUBLISHED` separation, verified export streaming, and owner approval already live. | None to business logic; mobile surfaces job creation, status tracking, export preview (`PNG`/`JPEG`/`PDF`), and explicit approval/publish confirmation. |
| **Templates & Windows Agent Status** | `api/templates/**`, `api/agents/**` | **Read-only status/catalog 100% reusable.** | Mobile `More` tab can display read-only Windows Creative Agent connection/heartbeat status and template catalog summary (desktop Affinity editing stays on Web + Windows Agent). |
| **Events & Programmes / Asset Library** | [`events/page.tsx`](file:///d:/Projects/Crelune/apps/web/src/app/(dashboard)/events/page.tsx) (**Milestone 7**), [`assets/page.tsx`](file:///d:/Projects/Crelune/apps/web/src/app/(dashboard)/assets/page.tsx) (**Milestone 8**) | **Not implemented yet** in schema or APIs (`Event` and `Asset` models do NOT exist in `schema.prisma`). | **Do NOT invent fake endpoints or pull Milestone 7/8 schemas prematurely.** Display honest Roadmap integration placeholders in `Calendar` / `More` until Milestones 7 and 8 are built (unless Product Owner explicitly re-sequences). |
| **Shared Packages** | [`packages/shared/src/index.ts`](file:///d:/Projects/Crelune/packages/shared/src/index.ts), [`packages/ui/src/index.ts`](file:///d:/Projects/Crelune/packages/ui/src/index.ts), [`packages/ui/src/tokens/colors.ts`](file:///d:/Projects/Crelune/packages/ui/src/tokens/colors.ts) | `@crelune/shared` has **zero Node built-in imports** (`zod` + `date-fns` only) — safe for React Native! `@crelune/ui` root exports **DOM HTML components** (`<button>`, `className`, `react-dom`) and CSS string spacing/typography. | Add a pure RN-safe subpath export `@crelune/ui/colors` (or `@crelune/ui/tokens/colors`) in `packages/ui/package.json` so mobile imports canonical brand hex colors without importing web DOM components. Map numeric RN spacing/radii/typography in `apps/mobile/src/theme/`. Never import server `validateEnv()` from `@crelune/shared` in mobile. |

---

## 3. Mobile Technical Architecture

### 3.1 Stack & Monorepo Integration
- **Framework:** Expo **SDK 58** (`expo@58.0.26`) + **React Native `0.88.1`** (New Architecture mandatory) + **TypeScript `^5.7.3`** + **Expo Router v7** (`expo-router@58.0.32`).
- **Workflow Choice:** **Expo Continuous Native Generation (CNG) + Development Builds (`expo-dev-client`)** — NOT Expo Go for full verification (Expo Go does not support remote push notifications on modern SDKs and lacks production-parity native module configs) and NOT manual bare native project maintenance. Native Android/iOS projects are generated reproducibly from `app.config.ts` and config plugins during `expo prebuild` / EAS Build.
- **Workspace Location:** `apps/mobile` (`@crelune/mobile`) registered automatically via root `"workspaces": ["apps/*", "packages/*"]`.
- **Metro Bundler Configuration (`apps/mobile/metro.config.js`):**
  - Configure `watchFolders` to include monorepo root (`../..`), `resolver.nodeModulesPaths` to resolve both `apps/mobile/node_modules` and `../../node_modules`, and `disableHierarchicalLookup` carefully tested against npm workspaces hoisting.
  - Ensure `@crelune/shared` builds (`npm run build --workspace=@crelune/shared`) cleanly or resolves cleanly without pulling `@crelune/database` or Node-only packages (explicitly block `@crelune/database` and `@prisma/client` via Metro `blockList` as a defense-in-depth guardrail!).
- **Recommended Mobile Dependencies (Minimal, Maintained, Expo-Matched):**
  - Navigation & Safe Areas: `expo-router`, `react-native-safe-area-context`, `react-native-screens`, `react-native-gesture-handler`
  - Secure Storage & Device Identity: `expo-secure-store`, `expo-device`, `expo-constants`, `expo-application`
  - Camera, Photos & Compression: `expo-image-picker`, `expo-image-manipulator`, `expo-image`, `expo-file-system`
  - Notifications & Haptics & Linking: `expo-notifications`, `expo-haptics`, `expo-linking`
  - Network & Read Cache: `@react-native-community/netinfo`, `@tanstack/react-query` (or lightweight focused cache store — **recommended: `@tanstack/react-query` + scoped AsyncStorage read cache for non-sensitive list/summary metadata, purged completely on logout**), `lucide-react-native` + `react-native-svg` (matching CRELUNE Web's Lucide iconography cleanly).
  - *Strict Prohibition:* Zero `react-native-webview`, zero `@prisma/client`, zero AWS S3 SDK, zero server secrets in `EXPO_PUBLIC_*` variables.

### 3.2 Shared Package Boundaries
```text
packages/shared   --> Pure TS types, Zod schemas, civil birthday date math, design job state machine
                      (Consumed by apps/web, apps/agent, apps/mobile — NEVER server env/DB secrets)
packages/ui       --> Web React DOM components (apps/web ONLY)
                  --> Subpath export `@crelune/ui/colors` (pure hex tokens shared by apps/web + apps/mobile)
packages/database --> Prisma client + SQL triggers (apps/web & CLI scripts ONLY; blocked in apps/mobile Metro config)
apps/web          --> Next.js web workspace + AUTHORITATIVE shared REST API (`/api/*`)
apps/mobile       --> Native iOS & Android Expo Router app (consumes `/api/*` via HTTPS + `@crelune/shared`)
```

### 3.3 Secure Mobile Authentication & Session Lifecycle (Recommended Design)

**Why web cookie auth cannot be reused directly:**
1. Browser cookies rely on ambient credential attachment protected by `Origin`/`Referer` CSRF checks ([`csrf.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/auth/csrf.ts)), which native HTTP stacks do not emit.
2. Native cookie jars (`NSURLSession` / `OkHttp`) lack deterministic revocation per device and do not integrate cleanly with iOS Keychain / Android Keystore (`expo-secure-store`).
3. If a phone is lost or stolen, the owner needs **per-device revocation** that immediately stops API access and disables push notifications to that device without invalidating CRELUNE Web or the Windows Creative Agent.

**Proposed Mobile Auth Architecture (Two-Token Rotating Device Session):**
1. **Sign-In (`POST /api/mobile/auth/login`):**
   - Validates `email` and `password` using the exact shared `scrypt` verification, constant-time dummy hash, and PostgreSQL `AuthThrottle` (`ip:` + `ip_acct:` / `acct_noip:`) logic used by Web login.
   - Accepts client device metadata (`deviceInstallId` UUID generated locally on install, `platform: 'IOS' | 'ANDROID'`, `deviceName`, `appVersion`, `osVersion`).
   - Inside a PostgreSQL transaction:
     - Upserts `MobileDevice` for `(organisationId, userId, deviceInstallId)` (clearing any prior `revokedAt` ONLY on fresh verified password sign-in, rotating session family).
     - Creates a `MobileSession` row storing **only the SHA-256 hash** of a 256-bit cryptographically random refresh token (`cln_mob_rt_<64-hex>`), `familyId`, `expiresAt` (`30 days`), and `lastUsedAt`.
     - Mints a short-lived (`15 minutes`) HMAC-SHA256 signed mobile access token (`typ: 'mobile_access'`, `{ sub, role: 'OWNER', org, ver: user.sessionVersion, dev: mobileDevice.id, sid: mobileSession.id, iat, exp }`) signed using `SESSION_SECRET` (or optional dedicated `MOBILE_TOKEN_SECRET` — defaulting strictly to fail-closed `SESSION_SECRET` with distinct `typ: 'mobile_access'` domain separation so a mobile token can NEVER be replayed as a web cookie and vice versa!).
   - Returns `{ accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, device, user }` with `Cache-Control: private, no-store`.
2. **Secure Device Storage (`expo-secure-store`):**
   - Access token, refresh token, and `deviceInstallId` are stored exclusively in **iOS Keychain** (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` / `WHEN_UNLOCKED_THIS_DEVICE_ONLY`) and **Android Keystore-backed EncryptedSharedPreferences** via `expo-secure-store`.
   - Plaintext tokens are NEVER stored in `AsyncStorage`, Redux/Zustand persistence, URLs, crash reports, or logs.
3. **Silent Refresh & Reuse Detection (`POST /api/mobile/auth/refresh`):**
   - Acquires a `FOR UPDATE` row lock on `mobile_sessions` (and `mobile_devices`) in PostgreSQL.
   - Verifies `user.isActive`, `user.role === 'OWNER'`, `user.sessionVersion`, `device.revokedAt === null`, and `session.revokedAt === null && session.expiresAt > now`.
   - **Replay / Theft Detection:** If a previously rotated refresh token (`replacedBySessionId IS NOT NULL`) is presented again, **immediately revoke the entire `familyId`**, reject with `401`, and write an `AuditLog` security event (`MOBILE_SESSION_REUSE_DETECTED`).
   - Otherwise, atomically mark the old session rotated, issue a new refresh token + new `15m` access token, and serialize concurrent client refreshes via a single in-flight refresh mutex in the mobile API client.
4. **Authoritative Server Enforcement on Every Request:**
   - **Edge Middleware (`middleware.ts`):** For `/api/*` owner routes (excluding `/api/agent/*`, `/api/cron/*`, `/api/mobile/auth/*`), if no valid `crelune_session` cookie is present, checks `Authorization: Bearer <token>` via Web Crypto `verifyMobileAccessTokenEdge()` (requiring `typ === 'mobile_access'`, valid signature, valid lifetime `exp - iat <= 900s`). Never allows mobile Bearer tokens on HTML web routes (`/` etc.) and never reads tokens from query strings!
   - **Route Guard (`requireAuthenticatedOwnerApi`):**
     - If authenticated via `crelune_session` cookie -> enforces existing DB owner check + **mandatory CSRF Origin check** (`verifyCsrf: true`).
     - If authenticated strictly via `Authorization: Bearer` (mobile access token, with NO cookie fallback) -> validates `User` (`isActive`, `role === 'OWNER'`, `organisationId`, `sessionVersion`) **AND** validates `MobileDevice` (`revokedAt === null`) **AND** `MobileSession` (`revokedAt === null`, `expiresAt > now`) in PostgreSQL, and safely skips browser Origin CSRF check (because `Authorization` headers are never attached automatically by cross-site browser requests!).
     - *Mixed-header hardening:* If BOTH a cookie AND a Bearer token appear on a request, reject fail-closed (`400`/`401`) or require explicit single-transport handling so CSRF can never be bypassed by sending a dummy header alongside a cookie! Specifically: only treat as Bearer-authenticated when the Bearer token itself verifies validly AND no session cookie is used to authenticate the call.
5. **Logout & Lost-Device Revocation:**
   - `POST /api/mobile/auth/logout` revokes the current `MobileSession` family AND clears/deactivates the device's `expoPushToken` so a logged-out phone stops receiving private birthday alerts immediately. Mobile wipes `expo-secure-store`, clears query/read caches, clears `expo-image` memory cache, and deletes any downloaded temporary PDFs in app cache.
   - `POST /api/mobile/devices/[id]/revoke` (callable from CRELUNE Web Settings or another signed-in session) sets `MobileDevice.revokedAt = now`, revokes all `MobileSession` rows for that device, disables its push token, and records `MOBILE_DEVICE_REVOKED` in `AuditLog`.

### 3.4 API Client, Validation & Error Handling
- Single typed client (`apps/mobile/src/api/client.ts`):
  - Enforces **HTTPS strictly** for non-local hosts (`http://` allowed ONLY in `__DEV__` for explicit local LAN/loopback dev URLs like `http://10.0.2.2:3000` on Android emulator or `http://192.168.x.x:3000` on LAN; release builds reject non-HTTPS fail-closed!).
  - Attaches `Authorization: Bearer <accessToken>`, `Accept: application/json`, `X-Crelune-Client: mobile`, and request timeouts (`15s` JSON, `60s` photo upload).
  - Parses every response through `@crelune/shared` Zod schemas at the client boundary so malformed or unexpected backend payloads fail explicitly instead of silently crashing screens.
  - Handles `401` via a single-flight refresh mutex (`POST /api/mobile/auth/refresh`); if refresh returns `401`, wipes secure storage and routes cleanly to `/(auth)/login` with an understandable `"Your session expired. Please sign in again."` banner.
  - Maps `400/403/404/409/413/429/5xx` and offline network errors into typed, user-readable error states (never exposing raw stack traces or tokens).

### 3.5 Offline Behavior & Retry Strategy
Per [`crelune-mobile`](file:///d:/Projects/Crelune/.agents/skills/crelune-mobile/SKILL.md) Section 14, **do NOT build complex offline-first conflict-resolution editing**. Instead, implement a reliable, honest **online-authoritative with read-only cache** model:
- **Connectivity Detection:** `@react-native-community/netinfo` drives a quiet top status bar (`"Offline — showing last synced data"` with last-synced timestamp).
- **Safe Read-Only Cache:** Cache non-sensitive operational reads (`Home` dashboard summary, upcoming birthdays list, member directory list, active design job list, notifications list) in memory + scoped local cache with explicit staleness markers; **never** cache raw credentials, and **purge all cached personal data completely on logout or revocation**.
- **Mutations Require Server Confirmation:** Member registration, photo upload, design creation, design status transitions, publish approvals, and settings updates execute only with server confirmation, using disabled submit buttons / idempotency protection to prevent duplicate submissions on double-tap or flaky networks.
- **Retry Policy:**
  - `GET` reads: bounded exponential backoff (max 2 retries on network/5xx only, never on 401/403/404/400).
  - Mutations (`POST`/`PATCH`/`DELETE`): no blind automatic retries unless idempotent; show clear inline error + explicit `"Retry"` action preserving the user's unsaved form input and selected local photo URI so zero work is lost!

### 3.6 Camera, Gallery, Image Normalization & Photo Uploads
- **Just-In-Time Permissions:** Request Camera (`NSCameraUsageDescription` / `CAMERA`) or Photo Library (`NSPhotoLibraryUsageDescription` / Android Photo Picker — `READ_MEDIA_IMAGES` not even required on Android 13+ when using the system Photo Picker via `expo-image-picker`!) **only when the user taps "Take Photo" or "Choose from Library"**, preceded by a concise purpose prompt when needed. If denied/restricted, show a graceful inline fallback with a button to open OS Settings (`Linking.openSettings()`) — never crash or spam prompts.
- **Client-Side Normalization Pipeline (`apps/mobile/src/media/photo-normalizer.ts`):**
  1. User captures via camera or selects from gallery (`expo-image-picker`, `mediaTypes: ['images']`, `allowsEditing: true`, `aspect: [1, 1]` or portrait `[4, 5]` option).
  2. Preview selected image immediately in UI (clearly marked `"Ready to upload"` — never claiming saved until HTTP `200` returns!).
  3. Normalize with `expo-image-manipulator`:
     - Resize if `max(width, height) > 2048` (preserving aspect ratio).
     - Transcode to `SaveFormat.JPEG` (`compress: 0.85`), converting iOS **HEIC/HEIF** and oversized Android RAW/48MP captures into clean `< 2 MB` JPEGs guaranteed compatible with backend `POST /api/members/[id]/photo` (`image/jpeg`, `<= 10 MB`).
  4. Upload via `POST /api/members/[id]/photo` (`multipart/form-data`, field name `file`, `Authorization: Bearer <token>`) with visible upload progress bar, cancel support, and retry preserving the prepared image on interruption.
  5. Backend [`image-processor.ts`](file:///d:/Projects/Crelune/apps/web/src/lib/storage/image-processor.ts) performs authoritative magic-byte inspection, `sharp` decode, EXIF/GPS stripping, private S3 storage in `crelune-dev-member-photos`, and returns updated `photoUpdatedAt` (used as cache-buster for `<Image>`).
  6. Clean up temporary normalized cache file from app cache directory after upload completes or is cancelled.

### 3.7 Push Notifications & Deep Linking Architecture
- **Delivery Topology:**
  ```text
  Cron / Manual Birthday Sync -> birthday-processor-service.ts (PostgreSQL TX: Notification + BirthdayReminder=SENT)
                                        |
                                        +-> Enqueues PushDelivery (PENDING) per active MobileDevice with push enabled
                                              (UNIQUE(notificationId, mobileDeviceId) prevents duplicate pushes!)
                                        |
                                        v (Strictly OUTSIDE DB row locks!)
                                  push-dispatcher-service.ts -> Expo Push API (HTTPS)
                                                                      |
                                                       +--------------+--------------+
                                                       v                             v
                                                   FCM v1 (Android)              APNs .p8 (iOS)
  ```
- **Permission UX:** Never request notification permission on cold launch before sign-in! Present an in-context card on `Home` or `More -> Notifications` explaining *"Enable push alerts for upcoming member birthdays and design updates"*, then trigger `Notifications.requestPermissionsAsync()`. Respect denials cleanly with a link to OS Settings.
- **Android Notification Channels (Android 8+):** Create dedicated channels on startup (`birthdays` — High importance, `designs` — Default importance, `system` — Default importance) with CRELUNE violet accent `#6541A5`.
- **Privacy-Safe Push Payloads:**
  - Title/body keep personal details minimal (e.g., `"Upcoming birthday (3 days)"` / `"Kofi's celebration is on 26 Nov."` — never phone numbers, emails, birth years, or private URLs).
  - `data` contains strictly typed opaque navigation tokens validated on the client before routing:
    - `{ version: 1, kind: 'BIRTHDAY_REMINDER', target: 'member', memberId: '<cuid>', notificationId: '<cuid>' }`
    - `{ version: 1, kind: 'DESIGN_UPDATE', target: 'design', designJobId: '<cuid>', notificationId: '<cuid>' }`
    - `{ version: 1, kind: 'SYSTEM', target: 'notifications', notificationId: '<cuid>' }`
- **Safe Deep Linking (`crelune://` + Expo Router):**
  - Validate incoming deep link / notification payload via a shared Zod schema in `@crelune/shared` (`mobileDeepLinkPayloadSchema`) enforcing CUID/safe-ID regexes; reject arbitrary paths or external URLs fail-closed!
  - Always gate deep-link navigation behind active authentication: if unauthenticated, retain a safe validated pending destination in memory and navigate only after successful sign-in and authoritative backend fetch (`GET /api/members/[id]` or `GET /api/designs/[id]`).
- **Token Hygiene:** Re-register `expoPushToken` on sign-in, token rotation listener (`addPushTokenListener`), and app foreground check; mark `PushDelivery` `DEVICE_UNREGISTERED` and deactivate stale `MobileDevice.expoPushToken` automatically when Expo receipts return `DeviceNotRegistered`.

### 3.8 Platform-Specific UI, Ergonomics & Accessibility
- **Navigation Shell (Expo Router Native Tabs):**
  - iOS: standard native tab bar with SF-style crisp spacing, hairline top border `#E8E5ED`, swipe-back stack navigation, `KeyboardAvoidingView` (`behavior="padding"`), safe-area insets.
  - Android: edge-to-edge safe-area insets (`react-native-safe-area-context`), hardware Back button handled cleanly by Expo Router stacks (no trapping loops), Material ripple feedback with `>= 48dp` touch targets (`>= 44pt` on iOS).
- **Haptics:** Subtle `expo-haptics` impact/notification feedback strictly on deliberate milestones (photo captured, member saved, design approved/published) — never noisy.
- **Accessibility (WCAG 2.2 AA):**
  - Respect system Dynamic Type / font scaling (`allowFontScaling={true}`, flexible card heights that never clip large text).
  - Explicit `accessibilityRole`, `accessibilityLabel`, `accessibilityHint`, and `accessibilityState` on every button, tab, status chip, avatar, and toggle.
  - Preserve verified contrast ratios from [`DESIGN_SYSTEM.md`](file:///d:/Projects/Crelune/docs/DESIGN_SYSTEM.md) (`#24212B` on `#FFFFFF` = `13.4:1`, `#6541A5` on `#FFFFFF` = `6.2:1`, `#77727F` on `#FFFFFF` = `4.7:1`).
  - Respect OS Reduced Motion (`AccessibilityInfo.isReduceMotionEnabled()`).

---

## 4. Product Experience & Native Navigation Blueprint

### 4.1 Validated 5-Tab Bottom Navigation Structure
Aligned directly with [`PRODUCT_MASTER_SPECIFICATION.md`](file:///d:/Projects/Crelune/docs/PRODUCT_MASTER_SPECIFICATION.md) Section 6 and [`DESIGN_SYSTEM.md`](file:///d:/Projects/Crelune/docs/DESIGN_SYSTEM.md) Section 6.2:

| Tab | Icon (Lucide) | Primary Purpose | Live Backend Sources |
|---|---|---|---|
| **1. Home** | `Home` / `Sparkles` | Calm creative studio daily briefing: greeting + today's civil date, urgent upcoming birthdays (Today / This Week), designs awaiting review / active queue, unread notification bell, and two restrained quick actions (`+ Add Member`, `+ New Design`). | `GET /api/dashboard`, `GET /api/notifications?unreadOnly=true` |
| **2. Calendar** | `Calendar` | Monthly birthday calendar grid + quick filter chips (`Today`, `This Week`, `This Month`, `Upcoming`) + per-member preparation status (`UPCOMING`..`PUBLISHED`) + leap-day badge + quick "Start Birthday Flyer" or status update + honest Milestone 7 banner noting Events & Programmes join this timeline in Milestone 7. | `GET /api/birthdays`, `POST /api/birthdays/sync`, `PATCH /api/birthdays/[memberId]/[targetYear]/status` |
| **3. Designs** | `Palette` | Visual design job cards (not dense desktop tables!) filtered by active status (`All Active`, `Awaiting Review`, `In Progress`, `Exported`, `Published`), detail screen with brief/notes/linked member/template version badge, status transitions, verified export image/PDF viewer, and explicit two-step **Approve -> Exported -> Publish** confirmation (never auto-publishing!). | `GET /api/designs`, `POST /api/designs`, `GET /api/designs/[id]`, `POST /api/designs/[id]/transition`, `GET /api/designs/[id]/preparation`, `GET /api/designs/[id]/exports/[exportId]/file`, `PATCH /api/designs/[id]/exports/[exportId]/approval` |
| **4. Members** | `Users` | Fast searchable directory (debounced search + Active / Archived filter), crisp avatar rows, `+` primary button for **< 30-second Member Registration** (Name + Birthday month/day + optional year + optional immediate Camera/Gallery photo + optional phone/notes), rich Member Profile (photo upload/replace/remove, upcoming birthday & prep status, linked birthday designs, archive/restore). | `GET /api/members`, `POST /api/members`, `GET/PATCH /api/members/[id]`, `POST /api/members/[id]/{archive,restore}`, `GET/POST/DELETE /api/members/[id]/photo` |
| **5. More** | `LayoutGrid` / `Menu` | Hub for secondary everyday utilities: **Notifications Inbox** (with unread count badge), **Birthday & Push Preferences**, **Connected Devices & Windows Creative Agent Status** (read-only heartbeat + revoke lost mobile devices), **Templates Quick Reference** (read-only catalog/preview), **Roadmap Preview** (Events — Milestone 7, Asset Library — Milestone 8), and **Sign Out**. | `GET /api/notifications`, `POST /api/notifications/[id]/read`, `POST /api/notifications/read-all`, `PATCH /api/settings/birthdays`, `PATCH /api/settings/notifications`, `GET /api/agents`, `GET /api/mobile/devices`, `POST /api/mobile/devices/[id]/revoke`, `GET /api/templates` |

### 4.2 Expo Router Directory Blueprint (`apps/mobile/app/`)
```text
apps/mobile/
├── app.config.ts                      # Dynamic Expo config (dev/preview/prod identifiers, plugins, permissions)
├── eas.json                           # EAS Build profiles (development, preview, production)
├── metro.config.js                    # Monorepo workspace resolution + @crelune/database blockList
├── package.json                       # @crelune/mobile workspace package
├── tsconfig.json
├── app/
│   ├── _layout.tsx                    # Root Providers (Auth, QueryClient, SafeArea, Push/DeepLink listener)
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   └── login.tsx                  # Calm owner sign-in (email + password, HTTPS server status, zero public signup)
│   ├── (tabs)/
│   │   ├── _layout.tsx                # 5 Native Bottom Tabs: Home, Calendar, Designs, Members, More
│   │   ├── index.tsx                  # Tab 1: Home
│   │   ├── calendar.tsx               # Tab 2: Calendar (Birthdays + Milestone 7 Events notice)
│   │   ├── designs.tsx                # Tab 3: Designs pipeline
│   │   ├── members.tsx                # Tab 4: Members directory
│   │   └── more.tsx                   # Tab 5: More hub
│   ├── members/
│   │   ├── new.tsx                    # Fast <30s Member Registration + Camera/Gallery capture
│   │   └── [id].tsx                   # Member Profile, photo capture/replace, birthday prep & linked designs
│   ├── designs/
│   │   ├── new.tsx                    # Create Design Job (optional pre-filled member & birthday target year)
│   │   └── [id].tsx                   # Design Detail, status transitions, export viewer & publish approval
│   ├── notifications.tsx              # Full Notifications Inbox (mark read / mark all read / deep-link tap)
│   ├── settings/
│   │   ├── birthdays.tsx              # Timezone, reminder intervals, leap-day policy
│   │   ├── notifications.tsx          # Push opt-in, permission status, test/channel settings
│   │   └── devices.tsx                # Signed-in mobile devices + Windows Creative Agent status
│   └── templates/
│       └── index.tsx                  # Read-only Templates reference
└── src/
    ├── api/                           # Typed HTTPS client, token refresh mutex, endpoint wrappers
    ├── auth/                          # SecureStore token manager, AuthContext, session guard
    ├── components/                    # Native CRELUNE primitives (SurfaceCard, StatusChip, EmptyState, Banner, Avatar)
    ├── media/                         # Camera/gallery picker + HEIC-to-JPEG manipulator + upload progress
    ├── notifications/                 # Expo Push registration, channels, deep-link parser & router
    ├── offline/                       # NetInfo hook, read-only cache helpers, logout purge
    └── theme/                         # Pure RN theme consuming `@crelune/ui/colors` + numeric spacing/type scales
```

### 4.3 Visual Identity Enforcement
- Exact brand palette imported from `@crelune/ui/colors`: Primary `#6541A5`, Muted Lavender `#A99AD1`, Background `#F8F7FA`, Surface `#FFFFFF`, Primary Text `#24212B`, Secondary Text `#77727F`, Border `#E8E5ED`.
- Restrained studio craft: crisp `1px` borders (`#E8E5ED`), `8px`–`12px` radii, flat surfaces, tabular numerals (`fontVariant: ['tabular-nums']`) for dates/counts, generous breathing room for member photos and exported artwork, zero neon gradients, zero glassmorphism, zero badge confetti.

---

## 5. Minimal Justified Database & Backend API Changes

Only changes directly required for secure native mobile auth, push delivery, and efficient mobile reads are proposed. **No speculative Event (M7) or Asset Library (M8) tables are added.**

### 5.1 Proposed Prisma Schema Additions (`packages/database/prisma/schema.prisma`)

1. **`MobileDevice` (`mobile_devices`)** — Replaces draft `DeviceRegistration` with full organisation isolation, device metadata, push token storage, and instant revocation:
   - `id` (`cuid`), `organisationId`, `userId`, `deviceInstallId` (client UUID), `platform` (`enum MobilePlatform { IOS, ANDROID }`), `deviceName` (`String?`), `osVersion` (`String?`), `appVersion` (`String?`), `expoPushToken` (`String? @unique`), `pushPermissionStatus` (`String?`), `pushEnabled` (`Boolean @default(true)`), `lastSeenAt` (`DateTime`), `revokedAt` (`DateTime?`), `revokedByUserId` (`String?`), `revocationReason` (`String?`), `createdAt`, `updatedAt`.
   - Composite org-scoped FK `(organisationId, userId) -> users(organisation_id, id)` (`onDelete: Cascade`), `@@unique([organisationId, userId, deviceInstallId])`, `@@unique([organisationId, id])`, `@@index([organisationId, userId, revokedAt])`.
2. **`MobileSession` (`mobile_sessions`)** — Rotating refresh-token sessions bound to `MobileDevice`:
   - `id` (`cuid`), `organisationId`, `userId`, `mobileDeviceId`, `familyId` (`String`), `refreshTokenHash` (`String @unique`), `replacedBySessionId` (`String?`), `expiresAt` (`DateTime`), `lastUsedAt` (`DateTime`), `revokedAt` (`DateTime?`), `createdAt`.
   - Composite org-scoped FK `(organisationId, mobileDeviceId) -> mobile_devices(organisation_id, id)` (`onDelete: Cascade`), `@@index([organisationId, userId, revokedAt])`, `@@index([familyId])`, `@@index([expiresAt])`.
3. **`PushDelivery` (`push_deliveries`)** — Durable deduplicated push outbox & receipt tracking:
   - `id` (`cuid`), `organisationId`, `notificationId`, `mobileDeviceId`, `status` (`enum PushDeliveryStatus { PENDING, TICKET_ACCEPTED, DELIVERED, FAILED, DEVICE_UNREGISTERED }`), `expoTicketId` (`String?`), `attemptCount` (`Int @default(0)`), `lastError` (`String?`), `sentAt` (`DateTime?`), `deliveredAt` (`DateTime?`), `createdAt`, `updatedAt`.
   - `@@unique([notificationId, mobileDeviceId])` (guarantees zero duplicate pushes per notification per device!), `@@index([organisationId, status, createdAt])`.
4. **`UserPreference` additions (non-destructive, default-backed columns):**
   - `pushNotificationsEnabled Boolean @default(true) @map("push_notifications_enabled")`
   - `pushBirthdayReminders Boolean @default(true) @map("push_birthday_reminders")`
   - `pushDesignUpdates Boolean @default(true) @map("push_design_updates")`

*(Migration safety: Strictly non-destructive `ADD COLUMN` / `CREATE TABLE` via `prisma migrate dev --create-only` against Neon `development` `br-nameless-silence-bexjp44k` only; zero `DROP` statements; Neon `production` untouched.)*

### 5.2 Proposed Backend API Additions & Guard Updates (`apps/web`)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/mobile/auth/login` | `POST` | Public (throttled via `AuthThrottle`, `4 KB` cap) | Owner password login for native mobile; registers/updates `MobileDevice`; returns `15m` access token + `30d` refresh token. |
| `/api/mobile/auth/refresh` | `POST` | Refresh token in JSON body (`4 KB` cap) | Row-locked atomic refresh-token rotation + replay/theft family revocation; checks `isActive`, `sessionVersion`, `device.revokedAt`. |
| `/api/mobile/auth/logout` | `POST` | Mobile Bearer | Revokes current `MobileSession` family and clears `expoPushToken` on that device. |
| `/api/mobile/devices` | `GET` | Owner (Web Cookie OR Mobile Bearer) | Lists registered mobile devices (name, platform, lastSeenAt, push status, active/revoked) for Settings & lost-device management. |
| `/api/mobile/devices/current/push-token` | `PUT` / `DELETE` | Mobile Bearer | Registers, rotates, or removes the current device's `expoPushToken` and OS permission status. |
| `/api/mobile/devices/[id]/revoke` | `POST` | Owner (Web Cookie + CSRF OR Mobile Bearer) | Immediately revokes a mobile device, all its sessions, and its push token; records `AuditLog`. |
| `/api/dashboard` | `GET` | Owner (Web Cookie OR Mobile Bearer) | Exposes existing `getDashboardSnapshot()` as JSON (`Cache-Control: private, no-store`) for mobile `Home`. |
| `/api/settings/notifications` | `GET` / `PATCH` | Owner (Web Cookie + CSRF OR Mobile Bearer) | Reads/updates `UserPreference` push toggles (`pushNotificationsEnabled`, `pushBirthdayReminders`, `pushDesignUpdates`). |
| Existing `/api/members/**`, `/api/birthdays/**`, `/api/designs/**`, `/api/notifications/**`, `/api/templates/**`, `/api/agents/**`, `/api/settings/birthdays` | Existing methods | **Extended:** Web Cookie (+ CSRF) **OR** verified Mobile Bearer | Reused 100% with zero duplicate routes or business logic! |

---

## 6. Android & iOS Build, Signing & Release Strategy

### 6.1 Build Profiles & Environment Separation (`eas.json` + `app.config.ts`)

| Profile | Purpose | Android Application ID *(Proposed)* | iOS Bundle Identifier *(Proposed)* | Deep-Link Scheme | Backend Target | Distribution |
|---|---|---|---|---|---|---|
| **`development`** | Local dev + physical device dev-client (required for real push & camera testing!) | `com.crelune.app.dev` | `com.crelune.app.dev` | `crelune-dev://` | Local LAN / Tunnel or Hosted Dev HTTPS | Local APK / EAS Dev Client (Android), EAS Ad-Hoc / Simulator (iOS) |
| **`preview`** | Pre-release QA on real Android & iOS phones against Neon `development` | `com.crelune.app.preview` | `com.crelune.app.preview` | `crelune-preview://` | Hosted Staging/Dev HTTPS | Google Play Internal Testing / APK + Apple TestFlight (Internal) |
| **`production`** | Owner's daily production release | `com.crelune.app` | `com.crelune.app` | `crelune://` (+ Universal/App Links later) | Hosted Production HTTPS | Google Play (Internal/Closed/Prod) + Apple TestFlight / App Store |

*(Note: `com.crelune.*` is a working namespace aligned with `.agents/AGENTS.md` Section 2; final reverse-DNS identifier should match a domain the founder controls before public store release!)*

### 6.2 Platform Build, Signing & Hosting Mechanics
- **Android-First Local & Cloud Builds:**
  - *Local builds on Windows 11 (Primary Dev Loop):* Supported directly using JDK 21 + Android SDK (`npx expo run:android`) against local emulators (`Medium_Phone_API_37.0`, `Small_Phone`) and a USB-connected physical Android device.
  - *Cloud & release builds (`.apk` / `.aab`):* Built via the Product Owner's existing Expo account using `eas build --platform android --profile development|preview|production` (using free/available EAS quota unless upgraded; do not assume paid tiers or preconfigured signing keys).
  - *Internal testing:* Planned via **Google Play Console -> Internal Testing** once a Google Play Console developer account is confirmed.
- **iOS Build Compatibility & Physical-Device Release Gate:**
  - *Workstation constraint:* Windows 11 (`xcodebuild` unavailable). Cloud macOS builds via **EAS Build** (`eas build --platform ios`) are required to compile iOS binaries while maintaining strict cross-platform TypeScript, Expo config plugin, `Info.plist`, and native dependency parity on every stage (no Android-only libraries permitted).
  - *Signing & TestFlight:* Requires a confirmed **Apple Developer Program** account (`$99/yr` — currently **UNCONFIRMED**) for provisioning profiles, APNs `.p8` push keys, and **Apple TestFlight Internal Testing**.
  - *Non-negotiable QA honesty rule:* Because the Product Owner does **not** currently have an iPhone, **EAS cloud builds alone NEVER count as physical-device verification**. Physical iOS runtime, camera/HEIC capture, APNs push delivery, VoiceOver/Dynamic Type, and TestFlight installation MUST remain explicitly marked **`PENDING / BLOCKED (Awaiting Physical iPhone)`** and are a mandatory gate prior to public release.
- **Vercel Hosting + Neon Backend & Cron Validation:**
  - **Vercel** is approved as the intended CRELUNE Web/API hosting platform, paired with **Neon Lakebase Postgres** and **Neon Object Storage** (`crelune-dev-member-photos`, `crelune-dev-creative` for dev/preview; strictly separated production branch/buckets later).
  - Before any production deployment change, validate on Vercel Preview/Development: HTTPS API reachability from mobile devices, `TRUST_PROXY="true"` + `ALLOWED_ORIGINS` compatibility (preserving Web CSRF + IP throttling per ADR 011/012), `sharp` serverless function runtime compatibility for `POST /api/members/[id]/photo` (multipart <= 10 MB vs Vercel function body limit — **IMPORTANT VERIFICATION ITEM: Vercel Serverless Functions enforce a `4.5 MB` request body limit, whereas `POST /api/members/[id]/photo` allows up to `10 MB`! Mobile client-side JPEG compression `<= 2048px` typically produces `< 1.5 MB` uploads, and we MUST explicitly validate/document Vercel body-size limits during Vercel deployment validation or evaluate presigned direct-to-S3 photo upload if > 4.5 MB is needed on Vercel!**), and scheduled cron invocation of `POST /api/cron/birthday-reminders` with `Authorization: Bearer <CRON_SECRET>`!
- **Push Notification Credentials (Never Committed to Git):**
  - **Android (FCM v1):** Requires Firebase project (**UNCONFIRMED**) -> Android `google-services.json` (supplied via gitignored local file / EAS secret env) + Google Service Account JSON uploaded via `eas credentials`.
  - **iOS (APNs):** Requires Apple Developer Program (**UNCONFIRMED**) -> `.p8` APNs Auth Key uploaded/managed via `eas credentials`, linked to `extra.eas.projectId`.
  - **Backend Push Auth (Optional Hardening):** Optional `EXPO_ACCESS_TOKEN` in server env so only CRELUNE backend can dispatch pushes to the EAS project.

### 6.3 Privacy Disclosures, Permission Descriptions & Store Submission Requirements
- **iOS `Info.plist` Strings (Required by Apple Review — concrete, non-generic):**
  - `NSCameraUsageDescription`: `"CRELUNE uses your camera so you can photograph members and attach portraits directly to their private member profiles."`
  - `NSPhotoLibraryUsageDescription`: `"CRELUNE accesses your selected photos so you can attach member portraits to private profiles and creative design requests."`
  - `ITSAppUsesNonExemptEncryption`: `false` (standard HTTPS/TLS only — avoids unnecessary export compliance delays in TestFlight).
- **Android Manifest Permissions (Least Privilege):**
  - `CAMERA` (for in-app photo capture), `POST_NOTIFICATIONS` (Android 13+ runtime prompt), `INTERNET`.
  - Use the Android System Photo Picker via `expo-image-picker` so broad `READ_MEDIA_IMAGES` / `READ_EXTERNAL_STORAGE` permissions are **not required** (aligning with Google Play Photo & Video Permissions policy!).
- **Store Submission & Privacy Requirements:**
  - **Google Play Data Safety Form & Apple App Privacy Nutrition Labels:** Accurately declare collected owner credentials, member directory/photo data (user-entered, private, not shared with third parties, not used for tracking), and push device tokens.
  - **Hosted Privacy Policy URL:** Required by both Apple App Store Connect and Google Play Console before publishing beyond initial draft.
  - **Single-Owner Review Note (Apple App Review / Google Play):** Planned initial distribution via **Apple TestFlight Internal Testing** and **Google Play Internal Testing** avoids public App Store/Play Store review friction for single-owner use while preserving full store-compliance readiness.

### 6.4 External Accounts, Devices & Infrastructure Status Matrix (No Assumptions)

| External Dependency | Current Status | What It Unlocks | What Remains Unblocked Without It |
|---|---|---|---|
| **Expo / EAS Account** | **CONFIRMED (Existing account)** *(plan tier & credentials unconfigured)* | EAS project ID, EAS config, cloud Android/iOS build pipelines | Local Android emulator & USB dev builds |
| **Vercel Hosting + Neon** | **APPROVED HOSTING DIRECTION** *(deployment & cron config unvalidated)* | Remote HTTPS API for physical devices + scheduled `POST /api/cron/birthday-reminders` | Local LAN / emulator (`10.0.2.2:3000`) dev against Neon `development` |
| **Physical Android Device** | **TO CONFIRM** *(AVDs `Medium_Phone_API_37.0` & `Small_Phone` verified locally)* | Real Android camera, cellular/Wi-Fi upload retries, TalkBack, real FCM push receipt | Android Emulator testing for UI, navigation, auth, virtual camera, and API integration |
| **Firebase Project (FCM v1)** | **UNCONFIRMED** | Android `google-services.json` & FCM v1 Service Account Key for real Android remote push | All Stages 6.1–6.5 + backend push unit/PG tests (with mocked Expo Push transport) |
| **Google Play Console Account (\$25 one-time)** | **UNCONFIRMED** | Google Play Internal Testing track & Play App Signing release | Local Android emulator & direct APK sideloading onto physical Android device |
| **Apple Developer Program Account (\$99/yr)** | **UNCONFIRMED** | iOS signing/provisioning, physical iOS dev builds, APNs `.p8` push key, TestFlight Internal Testing | Cross-platform iOS code compatibility, `expo prebuild --platform ios` config validation, iOS unit/component tests |
| **Physical iPhone** | **UNAVAILABLE CURRENTLY (Release Blocker)** | Physical iOS runtime, iPhone HEIC camera capture, real APNs push receipt, VoiceOver/Dynamic Type, TestFlight acceptance | EAS iOS compilation checks (when Apple account exists) — **explicitly NOT counted as physical-device verification; physical iPhone testing required before public release** |

---

## 7. Stage-by-Stage Implementation Plan (Milestone 6)

> Implementation is deliberately split into **7 focused, independently verifiable stages (6.1–6.7)** so backend auth/push security is proven on Neon `development` before mobile UI depends on it, and each mobile capability is tested on both Android and iOS.

---

### Stage 6.1 — Shared Package Prep, Mobile Auth Schema & Backend Mobile Auth + Dashboard API
- **Objective:** Establish secure, revocable per-device mobile authentication and `GET /api/dashboard` on the existing backend without breaking CRELUNE Web CSRF/cookie security or Windows Creative Agent auth.
- **Scope:**
  - Add `MobileDevice`, `MobileSession`, `PushDelivery`, `MobilePlatform`, `PushDeliveryStatus`, and `UserPreference` push toggle columns to Prisma schema (non-destructive migration on Neon `development` ONLY).
  - Add `@crelune/shared` mobile auth, device, notification preference, and deep-link Zod schemas.
  - Add `@crelune/ui/colors` subpath export in `packages/ui/package.json` for pure hex brand tokens.
  - Implement mobile access token signing/verification (Node + Edge Web Crypto with `typ: 'mobile_access'` domain separation), rotating refresh token service (with `FOR UPDATE` locking and family replay revocation), unified `requireAuthenticatedOwnerApi` (Web Cookie+CSRF vs pure Mobile Bearer), and `GET /api/dashboard`, `/api/mobile/auth/{login,refresh,logout}`, `/api/mobile/devices`, `/api/mobile/devices/[id]/revoke`, `/api/settings/notifications`.
  - Add Mobile Devices section in CRELUNE Web Settings (`/settings`) for owner visibility and one-click lost-device revocation.
- **Expected Files / Packages:**
  - `packages/database/prisma/schema.prisma`, new non-destructive migration SQL
  - `packages/shared/src/schemas/mobile.ts`, `packages/shared/src/index.ts`
  - `packages/ui/package.json`
  - `apps/web/src/middleware.ts`, `apps/web/src/lib/auth/{mobile-token.ts,edge-session.ts,owner-guard.ts,api-owner-guard.ts,mobile-auth-service.ts}`
  - `apps/web/src/app/api/mobile/auth/{login,refresh,logout}/route.ts`, `apps/web/src/app/api/mobile/devices/route.ts`, `apps/web/src/app/api/mobile/devices/[id]/revoke/route.ts`, `apps/web/src/app/api/dashboard/route.ts`, `apps/web/src/app/api/settings/notifications/route.ts`
  - `apps/web/src/app/(dashboard)/settings/page.tsx` + mobile-device management UI component
- **API / Database Impact:** Adds 3 new tables (`mobile_devices`, `mobile_sessions`, `push_deliveries`) with composite org-scoped FKs + 3 default-backed boolean columns on `user_preferences`; extends `middleware.ts` & `api-owner-guard.ts`.
- **Security Considerations:** Shared `AuthThrottle` & constant-time `scrypt` on mobile login; refresh tokens stored strictly as SHA-256 hashes; reuse detection revokes entire token family; strict domain separation (`typ: 'mobile_access'` cannot be used as web cookie); Web cookie mutations STILL require CSRF Origin/Referer; mixed cookie+Bearer bypass blocked; zero tokens in logs or query strings; Neon `development` only.
- **Android / iOS Verification:** `NOT APPLICABLE` (backend & shared foundation stage — verified via API/PG integration tests before mobile scaffolding).
- **Automated Tests:**
  - Unit tests: `middleware.test.ts` (Bearer allowlist, cookie preservation, query-token rejection, HTML route rejection), `mobile-auth-routes.test.ts` (CSRF non-regression on web vs Bearer mobile, mixed-header rejection, payload limits).
  - Neon `development` PostgreSQL integration test (`stage61-mobile-auth.pg.integration.test.ts`): login, concurrent refresh-token rotation race (`FOR UPDATE`), refresh replay family revocation, device revocation immediate `401`, `sessionVersion` global kill switch, cross-org isolation, `GET /api/dashboard`, and full existing web regression suite.
- **Acceptance Criteria:** Web auth & CSRF tests 100% pass; mobile Bearer can access all existing owner APIs; revoked mobile device fails immediately with `401`; replayed refresh token revokes family; Neon `development` clean post-test.
- **Dependencies / Blockers:** Product Owner approval of Stage 6.1 auth model & schema additions.

---

### Stage 6.2 — Expo SDK 58 Scaffold, Monorepo Metro Setup, Theme & Native Auth Shell
- **Objective:** Scaffold `apps/mobile` (`@crelune/mobile`) with Expo SDK 58 + Expo Router v7 + TypeScript, wire monorepo Metro resolution (`@crelune/shared`, `@crelune/ui/colors`), build the CRELUNE native design primitives, secure Keychain/Keystore login, and the 5-tab native shell.
- **Scope:**
  - Initialize `apps/mobile` (`app.config.ts`, `eas.json`, `metro.config.js`, `tsconfig.json`, Jest + `@testing-library/react-native` config).
  - Build `src/theme/` consuming `@crelune/ui/colors` with numeric RN typography, spacing, radii, and accessible touch targets (`>= 44pt` / `48dp`).
  - Implement `src/api/client.ts` (strict HTTPS enforcement in release, Zod response parsing, single-flight refresh mutex, `NetInfo` offline detection) and `src/auth/` (`expo-secure-store`, login/logout, session hydration, logout cache purge) satisfying all five mandatory refresh-token concurrency rules:
    - **A. Single-flight refresh:** One application-wide `refreshInFlightPromise` shared across proactive pre-expiry refresh, reactive `401` handling, foreground resume, and React Query retries.
    - **B. Stale access-token protection:** Each request tracks its sent token and credential generation so `401` responses from stale tokens reuse an already-rotated active token without triggering duplicate refresh rotation.
    - **C. Concurrent waiters & at-most-once retries:** Waiting callers share one refresh promise, retry at most once, and reject cleanly on refresh failure or concurrent logout.
    - **D. Persist-before-release ordering:** Newly rotated access/refresh tokens persist to SecureStore before mutating in-memory credentials, resolving `refreshInFlightPromise`, or releasing waiters; SecureStore write failures fail closed and wipe inconsistent auth state.
    - **E. Failure recovery & lost refresh response:** Terminal auth errors (`SESSION_EXPIRED`, `DEVICE_REVOKED`, `REFRESH_TOKEN_REUSE_DETECTED`, `INVALID_REFRESH_TOKEN`) wipe SecureStore, query/read caches, and private image memory cache and redirect once to `/(auth)/login` with an explanatory message; temporary network/timeout/`5xx` errors preserve credentials without forced sign-out; lost refresh responses recover deterministically via server `REFRESH_TOKEN_REUSE_DETECTED` on reconnect.
  - Implement `(auth)/login.tsx` and the 5 native bottom tabs (`Home`, `Calendar`, `Designs`, `Members`, `More`) with live `Home` wired to `GET /api/dashboard` and live `More` sign-out/account section.
- **Expected Files / Packages:** `apps/mobile/**`, root `package-lock.json` (workspace install).
- **API / Database Impact:** None (consumes Stage 6.1 APIs).
- **Security Considerations:** Zero server secrets or `@crelune/database` in bundle (Metro `blockList`); tokens stored strictly in `expo-secure-store`; non-HTTPS rejected in release builds; logout wipes secure storage and query cache; zero WebViews.
- **Android Verification:** Build & launch on local Windows Android Emulator (`Medium_Phone_API_37.0` and `Small_Phone`) via `npx expo run:android` against local dev server (`10.0.2.2:3000`) and physical Android device (if attached); verify login, Keystore persistence across cold restart, hardware Back button behavior, safe areas, and logout.
- **iOS Verification:** Run `npx expo-doctor`, `npx expo prebuild --platform ios` config/plugin validation, and cross-platform audit confirming zero Android-only libraries; EAS iOS build verification requires confirmed Apple Developer credentials, and **physical iOS runtime remains explicitly `PENDING / BLOCKED` (no iPhone currently available; EAS cloud builds alone do not count as physical-device verification)**.
- **Automated Tests:** Jest + RNTL tests for `client.ts` (401 single-flight refresh, refresh failure logout, HTTPS enforcement, offline error handling), `SecureStore` auth provider, login form validation, and 5-tab shell navigation + accessibility labels.
- **Acceptance Criteria:** Owner signs in on native app, sees live `Home` operational data from Neon `development`, restarts app with persistent session, signs out cleanly; monorepo `type-check`, `lint`, `build`, and `@crelune/mobile` tests pass.
- **Dependencies / Blockers:** Stage 6.1 complete; verify `compileSdkVersion` / Android SDK platform version match via `expo-doctor`; Expo/Apple accounts for iOS EAS build.

---

### Stage 6.3 — Members Directory, Fast (< 30s) Registration & Native Camera/Gallery Photo Uploads
- **Objective:** Deliver full native member lookup, rapid registration, profile editing/archival, and secure camera/gallery portrait capture with client-side HEIC-to-JPEG normalization.
- **Scope:**
  - `Members` tab (`app/(tabs)/members.tsx`): debounced search, Active/Archived segmented filter, paginated `FlatList`, authenticated private avatar rendering via `expo-image` (`Authorization: Bearer`, memory-only cache).
  - Fast Member Registration (`app/members/new.tsx`): single clean scrolling form (`KeyboardAvoidingView`), full name, preferred name, date-only month/day picker + optional birth year (never fabricated!), optional immediate Camera/Gallery photo capture, optional phone/email/notes, duplicate-submit guard.
  - Member Profile (`app/members/[id].tsx`): portrait preview + Take Photo / Choose Photo / Remove Photo actions, edit details, archive/restore with confirmation, linked upcoming birthday & birthday designs.
  - Media pipeline (`src/media/photo-normalizer.ts`): just-in-time Camera/Library permissions with graceful denial UI, `expo-image-manipulator` resize (`<= 2048px`) + JPEG transcode (`0.85`), multipart upload to `POST /api/members/[id]/photo` with progress bar, retry preserving local image, and local temp-file cleanup.
- **Expected Files / Packages:** `apps/mobile/app/(tabs)/members.tsx`, `apps/mobile/app/members/{new,[id]}.tsx`, `apps/mobile/src/media/*`, `apps/mobile/src/features/members/*`.
- **API / Database Impact:** None (reuses existing `/api/members/**` and `/api/members/[id]/photo`).
- **Security Considerations:** Private portraits loaded only with Bearer auth header and memory-only cache (never written to public gallery or persistent unencrypted disk cache, cleared on logout); client-side HEIC normalization paired with authoritative server `sharp` EXIF/GPS stripping; permission denied never crashes.
- **Android Verification:** Thorough verification on Android Emulator (virtual camera + gallery picker) and physical Android device (real camera capture, high-MP JPEG compression, upload progress/interruption retry, permission denial -> Settings link, and verified web sync).
- **iOS Verification:** Verify cross-platform `expo-image-picker` + `expo-image-manipulator` HEIC-to-JPEG logic via unit tests and validate `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` in `app.config.ts` / `Info.plist`. **Physical iPhone camera & HEIC capture acceptance remains `PENDING / BLOCKED (No Physical iPhone Available)` until tested on a real iPhone prior to public release.**
- **Automated Tests:** Jest + RNTL tests for fast registration validation (missing birth year, Feb 29, invalid dates), `photo-normalizer.ts` (HEIC/oversized resize + temp cleanup), upload failure retry without losing form state, permission-denied state, and member search/archive flows.
- **Acceptance Criteria:** Member created with portrait photo from mobile in `< 30s`, immediately visible identically on CRELUNE Web with EXIF stripped and birthday unshifted across timezones.
- **Dependencies / Blockers:** Stage 6.2 complete; physical devices for real camera verification.

---

### Stage 6.4 — Birthday Calendar, Preparation Tracking & Settings
- **Objective:** Deliver native Birthday Calendar, date-only civil birthday lists, preparation status management, manual reminder sync, and owner birthday preference editing.
- **Scope:**
  - `Calendar` tab (`app/(tabs)/calendar.tsx`): clean monthly calendar view with subtle violet dots on celebration days, filter segments (`Today`, `This Week`, `This Month`, `Upcoming`), preparation status chips (`UPCOMING`..`PUBLISHED`), leap-day policy indicator, quick action to update prep status (`PATCH /api/birthdays/[memberId]/[targetYear]/status`) or jump straight to creating/opening the linked Birthday Flyer job, pull-to-refresh + manual sync (`POST /api/birthdays/sync`), plus honest Milestone 7 note for upcoming Church Events/Programmes.
  - Birthday Settings (`app/settings/birthdays.tsx`): edit timezone (default `Africa/Accra`), reminder lead-day intervals (`7, 3, 1, 0`), and leap-day policy (`FEB_28` / `MAR_1`) via `PATCH /api/settings/birthdays`.
- **Expected Files / Packages:** `apps/mobile/app/(tabs)/calendar.tsx`, `apps/mobile/app/settings/birthdays.tsx`, `apps/mobile/src/features/birthdays/*`.
- **API / Database Impact:** None (reuses existing `/api/birthdays/**` and `/api/settings/birthdays`).
- **Security Considerations:** Date-only civil rendering using `@crelune/shared` helpers (immune to device timezone shifts!); server remains sole owner of reminder scheduling.
- **Android Verification:** Verify calendar rendering across `Small_Phone` and `Medium_Phone_API_37.0`, test timezone change on emulator (e.g., `America/Los_Angeles` vs `Africa/Accra` — birthdays MUST NOT shift day!), verify status update reflects immediately on Web.
- **iOS Verification:** Validate date-only rendering logic, cross-platform touch targets (`>= 44pt`), and Settings contracts via automated tests & iOS prebuild check; **physical iPhone UI/Dynamic Type verification remains `PENDING / BLOCKED (No Physical iPhone Available)` until tested on an iPhone prior to public release.**
- **Automated Tests:** Jest + RNTL tests around month/year boundary dates, Feb 29 leap-day display, missing birth years, timezone invariance, prep status mutations, and offline read-cache display.
- **Acceptance Criteria:** Mobile `Calendar` matches CRELUNE Web Birthday Operations record-for-record across timezones and leap years; manual sync and status updates persist authoritatively.
- **Dependencies / Blockers:** Stage 6.3 complete.

---

### Stage 6.5 — Design Management, Progress Tracking, Export Review & Explicit Approval
- **Objective:** Deliver native design-job creation, pipeline filtering, progress monitoring, verified deliverable viewing, and explicit review/publish approval (strictly preserving `EXPORTED !== PUBLISHED`).
- **Scope:**
  - `Designs` tab (`app/(tabs)/designs.tsx`): clean status filter chips (`Active`, `Awaiting Review`, `Approved`, `Exported`, `Published`, `All`), priority & deadline indicators, linked member + template version chip.
  - Create Design Task (`app/designs/new.tsx`): title, category (all 7 authoritative categories), optional member link + `birthdayTargetYear` (for `BIRTHDAY_FLYER`), priority, dimensions, target platform, required text, due date, template selection (optional from `GET /api/templates`).
  - Design Detail (`app/designs/[id].tsx`): full brief, immutable status history timeline, valid server-driven next-status transition buttons (`POST /api/designs/[id]/transition`), dispatch/Windows Agent preparation status badge (`GET /api/designs/[id]/preparation`), verified `ExportRecord` previews (authenticated `PNG`/`JPEG` via `expo-image`, `PDF` via app-private temp download + native share/preview), and two-step explicit confirmation dialogs for **Approve Export for Publish** (`PATCH .../approval`) and **Mark Published** (`EXPORTED -> PUBLISHED`).
- **Expected Files / Packages:** `apps/mobile/app/(tabs)/designs.tsx`, `apps/mobile/app/designs/{new,[id]}.tsx`, `apps/mobile/src/features/designs/*`.
- **API / Database Impact:** None (reuses existing `/api/designs/**` and `/api/templates`).
- **Security Considerations:** Strict server transition validation; explicit confirmation before `PUBLISHED` or `CANCELLED`; private export previews authenticated via Bearer header and temp PDFs purged on exit/logout; `409 DUPLICATE_BIRTHDAY_DESIGN_JOB` surfaced cleanly with link to existing job.
- **Android Verification:** Verify full job creation -> transition -> export image/PDF view -> approval/publish flow on Android Emulator + device; verify `409` duplicate birthday flyer handling.
- **iOS Verification:** Verify cross-platform design transitions, PDF preview/share module compatibility (`expo-sharing` / `expo-file-system`), and haptic calls via unit/component tests & iOS config checks; **physical iPhone rendering & share-sheet verification remains `PENDING / BLOCKED (No Physical iPhone Available)` until tested on an iPhone prior to public release.**
- **Automated Tests:** Jest + RNTL tests for create form validation (bidirectional `BIRTHDAY_FLYER` rules), valid transition matrix rendering, `409` conflict recovery, export-does-not-auto-publish UI guard, and temp PDF cleanup on logout.
- **Acceptance Criteria:** Owner creates design jobs, tracks Windows Agent / manual progress, inspects exported deliverables, and explicitly approves/publishes from mobile in full sync with CRELUNE Web.
- **Dependencies / Blockers:** Stage 6.4 complete.

---

### Stage 6.6 — Push Notifications Backend Dispatcher, Notifications Inbox, Deep Linking & `More` Hub
- **Objective:** Connect real Android (FCM v1) and iOS (APNs) push notifications end-to-end with CRELUNE's birthday reminder engine, deliver the native Notifications Inbox, validated deep linking, and complete the `More` hub.
- **Scope:**
  - **Backend Push Infrastructure (`apps/web`):**
    - Implement `PUT/DELETE /api/mobile/devices/current/push-token`.
    - Implement `apps/web/src/lib/notifications/push-dispatcher-service.ts`:
      - Enqueues `PushDelivery` (`PENDING`, unique per `(notificationId, mobileDeviceId)`) when birthday notifications (and optional design review notifications) are created, respecting `UserPreference.pushNotificationsEnabled` / `pushBirthdayReminders` and `MobileDevice.pushEnabled && revokedAt === null`.
      - Dispatches strictly **outside PostgreSQL row locks** to Expo Push API (`https://exp.host/--/api/v2/push/send`) with optional `EXPO_ACCESS_TOKEN`, recording `expoTicketId`, `TICKET_ACCEPTED`, retries (`<= 3`), and automatic deactivation on `DeviceNotRegistered`.
      - Add receipt reconciliation hook callable from `POST /api/cron/birthday-reminders` (bounded batch) to update `DELIVERED` / `FAILED` / `DEVICE_UNREGISTERED`.
  - **Mobile Notifications & `More` Hub (`apps/mobile`):**
    - In-context push permission onboarding + Android notification channels (`birthdays`, `designs`, `system`) + `Notifications.getExpoPushTokenAsync()` registration and rotation listener.
    - Cold-start, background, and foreground notification tap handling routed through Zod-validated `mobileDeepLinkPayloadSchema` (e.g., birthday reminder tap -> `app/members/[id]`, design alert tap -> `app/designs/[id]`, fallback -> `app/notifications`).
    - Notifications Inbox (`app/notifications.tsx`): unread filter, mark single read, mark all read.
    - `More` hub (`app/(tabs)/more.tsx`): Notifications entry with live unread count, Settings (`Birthdays`, `Notifications`, `Devices & Windows Agent`), Read-Only Templates catalog (`app/templates/index.tsx`), honest Milestone 7 (Events) & Milestone 8 (Asset Library) cards, and Sign Out.
- **Expected Files / Packages:**
  - `apps/web/src/lib/notifications/push-dispatcher-service.ts`, `apps/web/src/lib/birthdays/birthday-processor-service.ts` (post-commit push enqueue/dispatch hook), `apps/web/src/app/api/mobile/devices/current/push-token/route.ts`, `apps/web/src/app/api/cron/birthday-reminders/route.ts`
  - `apps/mobile/src/notifications/*`, `apps/mobile/app/notifications.tsx`, `apps/mobile/app/(tabs)/more.tsx`, `apps/mobile/app/settings/{notifications,devices}.tsx`, `apps/mobile/app/templates/index.tsx`
- **API / Database Impact:** Uses `MobileDevice.expoPushToken` and `PushDelivery` created in Stage 6.1; no destructive schema changes.
- **Security Considerations:** Minimal-PII push copy on lock screens; push token cleared on logout and device revocation; `PushDelivery` unique constraint prevents duplicate pushes; deep-link payloads strictly validated against Zod + auth-gated + re-verified via backend API before showing private data; push network errors NEVER roll back or corrupt committed in-app `Notification` rows.
- **Android Verification:** Build EAS `development` Android build with Firebase `google-services.json` + FCM v1 key (once Firebase project is confirmed) -> install on physical Android device against Vercel preview/dev HTTPS backend -> trigger birthday reminder sync -> verify lock-screen delivery, channel grouping, and tap deep-link to exact member profile! (Report explicitly as `BLOCKED` if Firebase project or physical Android device is unavailable.)
- **iOS Verification:** Verify iOS notification config plugins, APNs payload formatting, and Zod deep-link routing via automated tests & iOS prebuild validation. **Real APNs push delivery and cold-start tap acceptance remain explicitly `PENDING / BLOCKED (Unconfirmed Apple Developer Account & No Physical iPhone Available)` — EAS cloud builds alone do not verify iOS push delivery; physical iPhone testing is mandatory before public release.**
- **Automated Tests:**
  - Backend unit & Neon `development` PG integration tests (`stage66-mobile-push.pg.integration.test.ts`): deduplication under concurrent dispatch, `DeviceNotRegistered` automatic token cleanup, revoked/logged-out device push suppression, push provider outage resilience (in-app notifications still created & `PushDelivery` records `FAILED` safely).
  - Mobile Jest + RNTL tests: deep-link schema validation (valid member/design routes, malicious/external path rejection, auth-gated deferred navigation), permission-denied flow, inbox mark-read/mark-all-read.
- **Acceptance Criteria:** Real birthday reminder triggers push delivery and deep-link navigation on physical Android (when Firebase project + Android device are available), duplicate reminders never send duplicate pushes, and iOS physical APNs acceptance is honestly recorded as `PENDING` until tested on a physical iPhone.
- **Dependencies / Blockers:** Stage 6.5 complete; **Firebase project (UNCONFIRMED)** for Android FCM v1, **Vercel preview/dev HTTPS deployment & cron validation**, physical Android device for live Android push, and **Apple Developer Program (UNCONFIRMED) + physical iPhone (UNAVAILABLE)** for live iOS APNs push.

---

### Stage 6.7 — Offline Polish, Vercel Deployment/Cron Validation, Accessibility Audit, Release Builds & Milestone 6 QA Sign-Off
- **Objective:** Complete cross-platform QA, offline/poor-network verification, Vercel dev/preview deployment & cron validation (including Vercel `4.5 MB` serverless body limit check against mobile compressed photo uploads), accessibility audit, EAS release build validation, documentation updates, and honest Milestone 6 Completion Report clearly separating verified Android acceptance from pending physical iOS acceptance.
- **Scope:**
  - End-to-end offline & reconnection testing on Android emulator + physical Android device (airplane mode -> stale-data banner -> failed mutation retry without data loss -> reconnect sync).
  - Validate Vercel preview/dev deployment of CRELUNE Web/API connected strictly to Neon `development` (`br-nameless-silence-bexjp44k`), confirming `TRUST_PROXY="true"`, `ALLOWED_ORIGINS`, `sharp` image processing, mobile compressed upload payload bounds (`< 4.5 MB`), and `POST /api/cron/birthday-reminders` execution before any production change.
  - Accessibility pass on Android (TalkBack / large font scale / Reduced Motion) + iOS VoiceOver/Dynamic Type code audit (marking physical iPhone VoiceOver runtime `PENDING`).
  - Security audit: verify zero secrets in compiled mobile JS bundle & manifests, verify logout Keystore/Keychain + cache wipe, verify lost-device revocation from CRELUNE Web Settings immediately invalidates mobile app.
  - Build `preview` / `production` Android (`.aab` / `.apk`) via EAS Build (and upload to Google Play Internal Testing once Play Console account is confirmed). Build iOS EAS archive once Apple Developer credentials are confirmed (explicitly recording TestFlight physical iPhone verification as `PENDING` until an iPhone is tested).
  - Update `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DATABASE_DESIGN.md`, `docs/TESTING_STRATEGY.md`, `docs/DEVELOPMENT_ROADMAP.md`, and produce `docs/milestones/MILESTONE_6_COMPLETION_REPORT.md`.
- **Expected Files / Packages:** `apps/mobile/eas.json`, `apps/mobile/app.config.ts`, optional `vercel.json` (if validated cron config is added), targeted polish fixes in `apps/mobile/src/**`, `docs/**`.
- **API / Database Impact:** None (Neon `production` remains untouched until explicit release approval).
- **Security Considerations:** Bundle secret scan (`SESSION_SECRET`, `DATABASE_URL`, `AWS_*`, `CRON_SECRET` strictly absent from mobile JS bundle & manifests); release builds enforce HTTPS-only API URLs; privacy labels verified against actual behavior.
- **Android Verification:** Clean `preview`/`production` Android build via EAS succeeds; full manual walkthrough on Android Emulator + physical Android device (login -> add member + camera photo -> birthday calendar -> design job -> push deep link -> offline -> revoke from Web).
- **iOS Verification:** Confirm zero Android-only libraries, clean `expo prebuild --platform ios`, and EAS cloud iOS build compilation (when Apple Developer account is available). **Physical iPhone runtime, camera, APNs push, VoiceOver, and TestFlight acceptance remain explicitly marked `PENDING / BLOCKED (Awaiting Physical iPhone)` and MUST be completed on an iPhone before any public release.**
- **Automated Tests:** Full monorepo regression: `npm run type-check`, `npm run lint`, `npm run build`, `@crelune/shared`, `@crelune/ui`, `@crelune/agent`, `@crelune/web`, `@crelune/mobile` test suites, and `npm run test:integration:db` against Neon `development` (with post-test DB/S3 hygiene check and Neon `production` untouched check).
- **Acceptance Criteria:** Every automated suite passes; full Android emulator & physical-device walkthrough passes with recorded evidence; Vercel preview/dev deployment & cron validated cleanly; iOS compatibility maintained with zero Android-only assumptions; all pending physical iOS & external-account release blockers honestly disclosed; Product Owner sign-off obtained before Milestone 7.
- **Dependencies / Blockers:** Stage 6.6 complete; **Google Play Console (UNCONFIRMED)** for Play Internal Testing; **Apple Developer Program (UNCONFIRMED) + Physical iPhone (UNAVAILABLE)** for iOS signing, TestFlight, and public-release iOS verification; **Firebase project (UNCONFIRMED)** for real Android FCM v1 push.

---

## 8. Remaining Proposals & Unconfirmed Dependencies Before Stage 6.1

### 8.1 Proposed Implementation Details Awaiting Approval (Needed to Start Stage 6.1)

| # | Proposal | Recommended Option | Impact |
|---|---|---|---|
| **1** | **Mobile Auth Architecture (Decision D)** | Rotating per-device `MobileDevice` + `MobileSession` refresh tokens (`30d`, SHA-256 hashed, replay family revocation) + `15m` signed access tokens (`typ: 'mobile_access'`) in `expo-secure-store`, with unified Bearer + Cookie/CSRF guard on existing `/api/*`. | Required to start Stage 6.1 schema & backend auth. |
| **2** | **Push Notification Stack (Decision B)** | **Expo Push Service** (backed by FCM v1 + APNs via EAS) + decoupled PostgreSQL `PushDelivery` outbox (`UNIQUE(notificationId, mobileDeviceId)`). | Required to start Stage 6.1 `PushDelivery` schema & Stage 6.6 dispatcher. |
| **3** | **Events (M7) & Asset Library (M8) Scope in M6** | Keep Milestone 6 strictly scoped to live modules (`Home`, Birthday `Calendar`, `Designs`, `Members`, Notifications, Settings, Read-Only Templates/Agent status) with honest Roadmap cards for Events (M7) & Asset Library (M8). | Prevents premature Milestone 7/8 schema changes. |
| **4** | **App Identifiers & Schemes** | Working identifiers `com.crelune.app` / `com.crelune.app.dev` / `com.crelune.app.preview` and schemes `crelune://` / `crelune-dev://` / `crelune-preview://` (or founder's preferred owned domain reverse-DNS). | Needed in Stage 6.2 `app.config.ts`. |

### 8.2 External Dependencies & Release Blockers (Not Required to Start Stage 6.1, Required Later)

| # | Dependency / Blocker | Current Status | Stage Where Required |
|---|---|---|---|
| **A** | **Physical Android Device** | To confirm (local emulators `Medium_Phone_API_37.0` & `Small_Phone` ready) | Stage 6.3 (real camera/upload), Stage 6.6 (real FCM push), Stage 6.7 |
| **B** | **Firebase Project (FCM v1)** | **UNCONFIRMED** | Stage 6.6 (Android remote push credentials) |
| **C** | **Google Play Console Account (\$25 one-time)** | **UNCONFIRMED** | Stage 6.7 (Google Play Internal Testing track) |
| **D** | **Apple Developer Program Account (\$99/yr)** | **UNCONFIRMED** | Stage 6.2/6.6/6.7 (iOS EAS signing, APNs `.p8` key, TestFlight Internal Testing) |
| **E** | **Physical iPhone** | **UNAVAILABLE (Hard Public-Release Blocker)** | Mandatory before public release (physical iOS runtime, camera/HEIC, APNs push, TestFlight acceptance — EAS builds alone do not satisfy this gate) |
| **F** | **Vercel Project & Cron Validation** | **Vercel approved as hosting platform**; actual deployment, env vars, `4.5 MB` serverless body limit check, and cron trigger remain to be validated before production changes | Stage 6.6 / 6.7 (remote device API + scheduled birthday push reminders) |

---

*End of Milestone 6 Phase 0 Architecture Validation & Implementation Plan (Revised with Product Owner Decision Update). Implementation has NOT started and awaits Product Owner approval to begin Stage 6.1.*
