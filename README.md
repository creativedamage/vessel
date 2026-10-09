# Vessel

Asset management for churches and non-profits — a modern, volunteer-friendly take on Snipe-IT.

Track every mic, laptop, light and folding table by **campus, room and ministry**. Staff sign in with **Microsoft Entra ID or Google Workspace**; volunteers use **shared kiosk devices** (no personal login, optional PIN) to check gear in and out in seconds.

> **Status: Milestone 1** — API + web dashboard. The Flutter volunteer app (M2) and SwiftUI macOS app (M4) build on the same API. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full plan.

## What works today

- **Check out / in station** (web): scan tags with a USB barcode scanner or type them, build a cart, then assign to a **person, ministry or room** in one tap. Scanning a room label sets the destination. Check-in tells you where each item goes back.
- **Batch API built for phones**: `POST /v1/checkouts/batch` with per-item idempotency keys, partial success, and race-safe locking (two devices can never check out the same mic).
- **Assets** with auto-assigned tags (`VSL-000123`), QR labels, search and filters, service records, warranty and service-due tracking.
- **Custom fields without migrations** — define "Sunday setup location" or "RF band" as data; values are validated per category.
- **Campuses → buildings → rooms** and **nested ministries** (Worship → Production → Audio).
- **People**: staff with roles (Owner, Admin, Manager, Viewer), volunteers and contacts; optional kiosk PINs with lockout.
- **Volunteer devices**: enroll a phone or iPad by scanning a one-time QR; scope it to campuses; revoke instantly.
- **Append-only audit log** of every change — who, from which device, before and after. Enforced by a database trigger.
- **SSO**: Entra ID and Google OIDC (auth code + PKCE). Dev sign-in for local work.
- Light and dark mode, responsive down to phone width. OpenAPI docs at `/docs`.

## Quick start

Requires **Node 22+** and **Docker**.

```bash
cp .env.example .env
npm install                 # also generates the Prisma client
npm run db:up               # Postgres 16 in Docker (creates vessel + vessel_test)
npm run db:deploy           # apply migrations
npm run db:seed             # demo church: 2 campuses, 9 ministries, 43 assets

npm run dev:api             # http://localhost:4000  (OpenAPI at /docs)
npm run dev:web             # http://localhost:3000
```

Sign in at <http://localhost:3000> with the dev form as `admin@grace.example` (Owner), `jordan@grace.example` (Manager) or `casey@grace.example` (Viewer).

### Tests

```bash
npm test                    # 24 API tests against a real Postgres (vessel_test)
npm run typecheck
```

The suite covers the Milestone 1 gate (20 items checked out to a ministry in one call, every one audited), idempotent retries, racing devices, PIN lockout, kiosk scope and revocation, role checks, custom-field validation, optimistic concurrency and the append-only audit log.

## Connecting SSO

**Microsoft Entra ID**

1. Entra admin center → App registrations → New registration (single tenant is fine to start).
2. Redirect URI (Web): `{WEB_ORIGIN}/api/v1/auth/oidc/entra/callback`
3. Certificates & secrets → new client secret.
4. Set `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` in `.env`.

**Google Workspace**

1. Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web application).
2. Authorized redirect URI: `{WEB_ORIGIN}/api/v1/auth/oidc/google/callback`
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_HOSTED_DOMAIN` (your Workspace domain).

Staff must exist in Vessel before they can sign in (directory sync arrives in Milestone 3). On first sign-in a person is matched by email **only** inside an organization whose `IdentityProvider` row trusts that Entra tenant or Google domain; after that they're matched by the immutable Entra `oid` / Google `sub`. Add that row once per church:

```sql
INSERT INTO "IdentityProvider" (id, "organizationId", source, "tenantOrDomain", config)
VALUES (gen_random_uuid(), '<org id>', 'ENTRA', '<tenant id>', '{}');
```

## Repository layout

```
apps/
  api/         Fastify 5 + TypeScript + Zod. Routes in src/routes, auth in src/auth
  web/         Next.js 16 + Tailwind 4 dashboard (proxies /api/* to the API)
packages/
  db/          Prisma 7 schema, migrations, client factory, demo seed
docs/          Architecture, auth and roadmap
```

## How auth works

| Caller | Credential | Notes |
| --- | --- | --- |
| Staff on the web | `vessel_session` httpOnly cookie | Set after SSO (or dev sign-in). 30-day sessions, revocable. |
| Staff on macOS / mobile | `Authorization: Bearer vs_…` | Same opaque session token, returned by sign-in. |
| Volunteer device | `Authorization: Bearer <kiosk JWT>` | 1-hour token minted by `POST /v1/kiosks/token` from an ES256 assertion signed with the device's enrolled key. |
| Volunteer on a kiosk | `pin: { personId, pin }` in the batch body | Only when the device requires a PIN; attributes the batch to that person. |

## Milestone 1 simplifications (on purpose)

- Staff bearer tokens are opaque, revocable session tokens rather than short-lived JWTs + refresh tokens.
- Kiosk tokens are bound to the device key at mint time (hourly), not per request (full DPoP comes with the mobile app).
- Managers can act on all assets in their organization; per-ministry scoping is planned.
- Directory sync, label printing, kits UI, inventory walks and imports are scoped for later milestones; their tables already exist.

## Roadmap

| Milestone | Scope | Gate |
| --- | --- | --- |
| **M1 · API + web** (this) | Schema, auth, assets, batch check-out/in, audit, dashboard | Staff check out 20 items to a ministry on the web; every change is audited |
| M2 · Volunteer mobile app | Flutter, kiosk enrollment, local index, continuous scanning, offline outbox | A volunteer checks out 20 items in under 30 s on a real phone |
| M3 · Sync, labels, import | Graph + Google Admin SDK sync, label printing, Snipe-IT/CSV import | A disabled Entra account loses access within 15 minutes |
| M4 · macOS app | SwiftUI, menu-bar lookup, HID + RFID scanners | A USB scanner checks in a cart without touching the mouse |
| M5 · Pilot | Inventory walks, reports, reminders, RLS, backups | A church runs four Sundays with no paper sign-out sheet |
