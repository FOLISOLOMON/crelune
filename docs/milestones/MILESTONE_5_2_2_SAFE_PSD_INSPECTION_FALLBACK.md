# Milestone 5, Stage 5.2.2 — Safe PSD Inspection Fallback

**Status:** COMPLETE  
**Branch:** `main`  
**Baseline Commit:** `468684ee169ed3c1f3c85d55c34be212db9b0fb4`  
**Target Environment:** Neon `development` (`br-nameless-silence-bexjp44k`), Private Creative Bucket `crelune-dev-creative`  
**Production Isolation:** Neon `production` (`br-withered-moon-be8coj8h`) and `crelune-dev-member-photos` untouched.

---

## 1. Summary of Changes

1. **Disabled Automatic PSD Parsing & Removed Worker Execution Path**:
   - Uninstalled `@webtoon/psd` from `apps/web/package.json` and `package-lock.json`.
   - Removed `'@webtoon/psd'` from `serverExternalPackages` in [next.config.mjs](file:///d:/Projects/Crelune/apps/web/next.config.mjs).
   - Deleted `apps/web/src/lib/templates/psd-parse-worker.mjs`.
   - Replaced `WebtoonPsdLayerInspector` / `worker_threads` wiring in [psd-inspector.ts](file:///d:/Projects/Crelune/apps/web/src/lib/templates/psd-inspector.ts) with [`validatePsdHeader`](file:///d:/Projects/Crelune/apps/web/src/lib/templates/psd-inspector.ts) — a minimal, zero-dependency, bounded 26-byte PSD header validator checking:
     - `<= 100 MB` (`CREATIVE_BYTE_LIMITS.TEMPLATE_MASTER_MAX_BYTES`)
     - Adobe PSD signature (`8BPS`)
     - Standard PSD v1 (`version === 1`; rejects PSB v2 and other versions)
     - Valid canvas dimensions (`1..30,000px`)
   - Removed `psdInspector` from `TemplateServiceDependencies` in [template-service.ts](file:///d:/Projects/Crelune/apps/web/src/lib/templates/template-service.ts) so no production API route or service path can spawn a PSD parser worker.

2. **Safe Manual PSD Fallback Contract**:
   - [`completeTemplateVersionUpload`](file:///d:/Projects/Crelune/apps/web/src/lib/templates/template-service.ts) accepts valid PSD uploads and registers them with:
     - `inspectionStatus: 'MANUAL_REQUIRED'`
     - `detectedLayersJson: null` (`detectedLayers: null`, `inspectedAt: null`, `inspection: null`)
     - `editabilityVerified: false`
     - Preserved validated optional owner-supplied dimensions (`input.widthPx ?? psdHeader.widthPx`, `input.heightPx ?? psdHeader.heightPx`)
     - Explicit `inspectionSummary`: `'PSD header validated; automatic layer inspection is disabled for safety. Complete layer inspection and field mapping manually in Affinity.'`
   - Updated [`getTemplateFormatCapabilities`](file:///d:/Projects/Crelune/packages/shared/src/domain/template.ts) so `PSD` honestly reports `supportsNodeLayerInspection: false`, `requiresManualMappingFallback: true`, and `recommendedDefaultInspectionStatus: 'MANUAL_REQUIRED'`.
   - Native Affinity formats (`.af`, `.afdesign`, `.afphoto`, `.afpub`) continue using `MANUAL_REQUIRED`.

3. **Documentation Updates**:
   - Updated [ARCHITECTURE.md](file:///d:/Projects/Crelune/docs/ARCHITECTURE.md), [SECURITY.md](file:///d:/Projects/Crelune/docs/SECURITY.md), and [MILESTONE_5_2_TEMPLATE_BACKEND.md](file:///d:/Projects/Crelune/docs/milestones/MILESTONE_5_2_TEMPLATE_BACKEND.md).

---

## 2. Verification Results

| Check | Command | Status | Observed Result |
|---|---|---|---|
| Type Check | `npm.cmd run type-check` | **PASS** | 0 errors across `@crelune/web`, `@crelune/database`, `@crelune/shared`, `@crelune/ui` |
| Lint | `npm.cmd run lint` | **PASS** | `✔ No ESLint warnings or errors` |
| Unit Tests | `npm.cmd test` | **PASS** | `@crelune/web`: 26 files / 197 tests (`psd-inspector.test.ts` 5/5, `template-service-psd-fallback.test.ts` 4/4); `@crelune/shared`: 8 files / 53 tests; `@crelune/ui`: 1 file / 3 tests |
| Full Build | `npm.cmd run build` | **PASS** | Next.js 15.5.29 production build + `@crelune/database`, `@crelune/shared`, `@crelune/ui` |
| DB + S3 Integration | `npm.cmd run test:integration:db` | **PASS** | **9/9 files, 49/49 tests PASS** (`1200.65s`) against Neon `development` (`br-nameless-silence-bexjp44k`) & `crelune-dev-creative`, with `afterAll` cleanup verified (`remainingOrgs === 0` and S3 test objects deleted) |

---

## 3. Future Reconsideration Note

Automatic PSD parsing may be reconsidered only in a future, separately approved stage using genuine OS-level process isolation, hard memory/resource controls, a restricted filesystem, and zero network or application-secret access.
