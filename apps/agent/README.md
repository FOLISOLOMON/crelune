# CRELUNE Windows Creative Agent (`@crelune/agent`)

Local authenticated Windows desktop bridge connecting CRELUNE Web/Backend with Serif/Canva Affinity 3.3 workspaces.

## Security & Safety Principles

- **Outbound HTTPS Only:** Never listens on external inbound network ports. Remote URLs require `https://` (`http://127.0.0.1` / `http://localhost` permitted only for local development).
- **Windows DPAPI Credential Storage:** Machine bearer tokens are encrypted with `System.Security.Cryptography.ProtectedData` (`CurrentUser` scope) into `%LOCALAPPDATA%\CRELUNE\Agent\config\agent-credentials.dpapi`. Plaintext tokens are never written to disk.
- **Strict Workspace Isolation:** Job files live strictly under `<workspaceRoot>/jobs/<jobId>/{source,working,assets,exports,logs}/`. Path traversal, absolute paths, UNC shares, and symlink escapes are rejected.
- **Master Template Immutability:** Original templates in `source/` are marked read-only and verified by SHA-256 before and after Affinity handoff.
- **Truthful Affinity 3.3 Integration:** Never enables Affinity scripting or MCP globally, never invents unsupported SDK APIs, requires explicit user approval before opening working copies via `%LOCALAPPDATA%\Microsoft\WindowsApps\Affinity.exe`, and falls back cleanly to manual preparation when automation is unavailable.
- **Export != Publish:** Validated PNG, JPEG, and PDF exports register as `ExportRecord` proofs (`isApprovedForPublish: false`, `publishedAt: null`). Publishing remains an explicit owner confirmation in CRELUNE Web.

## Usage

```powershell
# Build from repository root
npm run build --workspace=@crelune/agent

# 1. Generate a one-time pairing token in CRELUNE Web -> /settings
# 2. Pair this workstation (encrypts token using Windows DPAPI)
node apps/agent/dist/cli.js pair --api-url http://127.0.0.1:3000

# 3. Inspect Affinity installation, DPAPI store, and backend heartbeat
node apps/agent/dist/cli.js doctor

# 4. Claim & prepare a single queued creative job (prompts before opening Affinity)
node apps/agent/dist/cli.js process-once

# 5. Or run the background polling & heartbeat loop
node apps/agent/dist/cli.js run

# 6. Validate and upload an exported deliverable from workspaces/jobs/<jobId>/exports/
node apps/agent/dist/cli.js submit-export --dispatch <dispatchId> --job <jobId> --file final.png
```
