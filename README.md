# Family Messenger — Phase 1

Private family messenger prototype with client-side end-to-end encryption.

## What is implemented

- PWA for iPhone/Android/desktop browsers.
- Family bootstrap with first administrator.
- Single-use QR invitations (token in URL fragment, removed immediately from the address bar).
- Device identity: X25519-compatible encryption keys + Ed25519 signing keys.
- PIN-protected local keystore using Argon2id + XChaCha20-Poly1305.
- Pending-device approval by an administrator; the server receives only a sealed conversation-key envelope.
- Encrypted text messages with XChaCha20-Poly1305.
- PostgreSQL persistence of ciphertext and routing metadata only.
- Cookie session + CSRF protection.
- WebSocket reconcile signal plus canonical HTTP synchronization.
- PWA manifest/service worker.
- Unit/integration/E2E test sources and Docker PostgreSQL definition.

## Important status

This branch was authored in an environment that did not have npm registry access or Docker/PostgreSQL available. Source syntax was parsed successfully, but dependencies were not installed and the runtime test suite was not executed here.

## First verification on a development PC

Requirements:

- Node.js 22.12 or newer
- npm 10 or newer
- Docker Desktop / Docker Engine with Compose

Commands from the project root:

```bash
npm install
npm run dev:db
npm run typecheck
npm test
npm run build
npm run e2e
```

If all checks pass, run the two development processes in separate terminals:

```bash
npm run dev -w apps/server
```

```bash
npm run dev -w apps/web -- --host 0.0.0.0
```

Open `http://localhost:5173`.

## Test flow

1. On the first browser/device choose **Создать семью**.
2. Enter family name, administrator name, device name and a PIN with at least 6 digits.
3. In **Семейное управление** choose **Пригласить по QR**.
4. Open the QR link on the second device.
5. Join with another name/device/PIN.
6. On the administrator device confirm the pending device after checking its fingerprint.
7. The second device receives the sealed chat key and opens the family chat.
8. Exchange messages. The server database must contain ciphertext, not message plaintext.

## Development database

The dev compose file starts PostgreSQL 17 on `localhost:5432` using:

- database: `family`
- user: `family`
- password: `family-dev-only`

These are development-only credentials.

## Branch

Implementation branch: `feat/phase1-core`.

## Oracle Cloud first public test

The repository now includes a single-VM Oracle Cloud deployment path with private PostgreSQL networking, Caddy HTTPS, and a temporary sslip.io hostname derived from the VM public IPv4 address.

See:

```text
infra/oracle/README.md
```

After the project is uploaded to an Ubuntu VM and Oracle ingress allows TCP 80/443, the first deploy is:

```bash
sudo bash infra/oracle/bootstrap-ubuntu.sh
sudo bash infra/oracle/deploy.sh
```

The deploy script prints the public HTTPS URL when `/health` is reachable. A custom domain can replace the temporary sslip.io hostname later without changing the PWA/API routing.
