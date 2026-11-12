# CRELUNE — Creative Object Storage Bucket & Namespace Specification

**Document:** Stage 5.1 Storage Architecture & Bucket Verification  
**Project:** CRELUNE  
**Status:** Applied on Neon `development` (`br-nameless-silence-bexjp44k`)

---

## 1. Bucket Isolation Policy (Approved Product Owner Decision)

CRELUNE enforces strict storage isolation between sensitive member identity portraits and creative template/production artifacts:

| Purpose | Env Variable | Approved Neon Dev Bucket | Access Level | Notes |
|---|---|---|---|---|
| Member Photos | `OBJECT_STORAGE_BUCKET` | `crelune-dev-member-photos` | `private` | Preserved untouched from Milestone 3 |
| Creative Templates, Working Assets & Exports | `OBJECT_STORAGE_CREATIVE_BUCKET` | `crelune-dev-creative` | `private` | Provisioned in Stage 5.1 |

- **Production Target:** Neither member-photo storage nor creative storage is provisioned on Neon `production` (`br-withered-moon-be8coj8h`; `neon bucket list --branch production` remains `[]`). Both runtime loaders (`getObjectStorageConfig` and `getCreativeObjectStorageConfig`) fail closed when production is unapproved or if any dev bucket/branch value leaks into a production config.
- **Cross-Bucket Guard:** Runtime allowlists strictly pair `OBJECT_STORAGE_BUCKET` to `crelune-dev-member-photos` and `OBJECT_STORAGE_CREATIVE_BUCKET` to `crelune-dev-creative`. Cross-wiring either variable throws `StorageConfigError`.

---

## 2. Provisioned Neon Development Bucket & Credentials Verification

- **Neon Project:** `snowy-glitter-15583384`
- **Neon Branch:** `development` (`br-nameless-silence-bexjp44k`)
- **S3 Endpoint:** `https://br-nameless-silence-bexjp44k.storage.c-9.us-east-2.aws.neon.tech` (`us-east-2`)
- **Credential Binding:** `OBJECT_STORAGE_CREDENTIAL_BRANCH_ID="br-nameless-silence-bexjp44k"` using branch-scoped Neon Object Storage credentials (`storage:read`, `storage:write`) which authenticate both development buckets while remaining isolated from `production`.
- **Verified Live S3 Capabilities (Stage 5.1):**
  - Authenticated `PutObject`, `HeadObject`, `GetObject`, and `DeleteObject` succeeded cleanly against `crelune-dev-creative`.
  - Unauthenticated anonymous HTTPS GET returned HTTP `403`.
  - `GetBucketCors` and `PutBucketCors` are supported natively on Neon Object Storage for `crelune-dev-creative` (configured for `http://localhost:3000` `PUT`/`GET`/`HEAD` browser uploads; tight CORS verification remains mandatory in Stage 5.2 before live presigned browser uploads).

---

## 3. Server-Controlled Key Namespaces (`crelune-dev-creative`)

Original uploaded filenames are **never** used directly as object keys; keys always use validated identifiers and server-generated `objectId` tokens (UUID):

1. **Template Masters (Immutable):**
   `<envPrefix>/organisations/<organisationId>/templates/<templateId>/versions/v<versionNumber>/<objectId>.<psd|af|afphoto|afdesign|afpub>`
2. **Template Previews:**
   `<envPrefix>/organisations/<organisationId>/templates/<templateId>/previews/v<versionNumber>/<objectId>.<png|jpg|webp>`
3. **Working Assets (Job-Scoped Resolved Inputs):**
   `<envPrefix>/organisations/<organisationId>/working_assets/<scopeId>/<objectId>.<png|jpg|webp|pdf|psd|af|afphoto|afdesign|afpub>`
4. **Exported Deliverables (Separated from Publication):**
   `<envPrefix>/organisations/<organisationId>/exports/jobs/<designJobId>/<objectId>.<png|jpg|pdf>`

Key validators (`assertKeyMatchesTemplateMasterScope`, `assertKeyMatchesTemplatePreviewScope`, `assertKeyMatchesWorkingAssetScope`, `assertKeyMatchesExportDeliverableScope`) reject leading slashes, `..`, backslashes, `%` encoding, null bytes, mismatched org/template/job prefixes, and unapproved file extensions.

---

## 4. Direct-to-Storage Presigned Upload & Completion Contract (Stage 5.2 Boundary)

Template masters can reach `100 MB` and exports `50 MB`. In Stage 5.2, browser and Windows Agent uploads will use short-lived presigned PUT URLs governed by `CreativeUploadIntent`:

1. **Intent Creation (`PENDING`):** Server validates MIME type, requested `byteSize` (`<= maxAllowedBytes`), SHA-256 hex digest, and `idempotencyKey`, generates a strict server-scoped `storageKey`, and sets a short expiration (`expiresAt`).
2. **Direct PUT Upload:** Client uploads binary bytes directly to `crelune-dev-creative` via presigned PUT URL (server credentials never leave backend).
3. **Mandatory Completion Verification (`VERIFIED` / `REJECTED`):** Client calls completion endpoint; backend runs S3 `HeadObject` and stream verification to assert:
   - object exists and has not expired,
   - `ContentLength` matches `expectedByteSize` and `<= maxAllowedBytes` (prevents client lying at intent creation),
   - verified SHA-256 matches `expectedSha256` (when enforced) or computed hash is recorded before creating immutable `TemplateVersion` or `ExportRecord`.
4. **Failure / Abandonment Cleanup:** Rejected or expired objects are enqueued into `CreativeStorageCleanup` (isolated from member-photo `PendingStorageCleanup`).

