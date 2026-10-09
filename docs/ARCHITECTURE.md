# Vessel architecture

One TypeScript API on PostgreSQL serves three clients: a Next.js dashboard for staff, a SwiftUI macOS app, and a Flutter app for volunteers. Staff sign in through Entra ID or Google; volunteers use device-bound kiosk tokens plus an optional PIN.

```
 Web (Next.js)      macOS (SwiftUI)      Mobile (Flutter)
      │ cookie            │ bearer             │ kiosk token
      └───────────────────┼────────────────────┘
                          ▼
              Vessel API (Fastify, /v1)
     actor resolver → role/scope checks → handlers
     every write + its AuditEvent in one transaction
              │                         │
              ▼                         ▼
        PostgreSQL 16             Entra ID / Google
  (data, audit log, job queue)    (OIDC, directory sync)
```

## Terminology

| Snipe-IT | Vessel (UI) | Model |
| --- | --- | --- |
| Company | Ministry / Entity | `Ministry` (nested) |
| Location | Campus → Building → Room | `Campus`, `Room` (nested, materialized `path`) |
| User | Staff / Volunteer / Contact | `Person` |
| Asset model | Item type | `ItemType` (INDIVIDUAL or BULK) |
| Checkout | Check-out to person, ministry or room | `Checkout` |
| Audit | Inventory walk | `InventorySession` |
| Maintenance | Service record | `ServiceRecord` |
| Kit | Sunday setup bundle | `Kit` |

## Data rules worth knowing

- Every tenant table carries `organizationId`; every query filters by the caller's organization.
- `Checkout.clientOpId` is unique: devices generate one per scanned item, so retries are safe.
- A partial unique index (`Checkout_one_open_per_asset`) allows at most one open checkout per asset. The API also claims the asset with a conditional `UPDATE … WHERE status = 'AVAILABLE'`.
- `AuditEvent` rejects UPDATE and DELETE via a trigger.
- `Asset.version` gives optimistic concurrency for edits (and later, offline sync).
- Custom fields: definitions in `CustomFieldDef`, values in `Asset.customFields` (JSONB), validated per category by `validateCustomFields`.

## Mobile scanning flow (Milestone 2)

1. Home: *Check out* / *Check in*. The kiosk already knows its campus.
2. Scan continuously (`mobile_scanner`). Each code resolves against a local Drift index in under 50 ms and joins the cart with a haptic tick. Kit tags expand; room tags set the destination.
3. Choose who or where: recent ministries and rooms as tap targets, person type-ahead below.
4. Optional PIN, then *Done*. The batch goes to an outbox and the UI confirms immediately.
5. The outbox posts `/v1/checkouts/batch`; conflicts come back per item.

State lives in one Riverpod notifier per scan session (`mode`, `batchId`, ordered cart keyed by assetId, `target`, `phase`). The server is never in the scan loop.

## Endpoints (v1)

| Method | Path | Who |
| --- | --- | --- |
| GET | `/scan/:code` | staff, kiosk |
| POST | `/checkouts/batch`, `/checkins/batch` | manager+, kiosk |
| GET | `/checkouts` | viewer+ |
| GET/POST/PATCH | `/assets`, `/assets/:id`, `/assets/:id/retire`, `/assets/:id/service-records` | viewer+ / manager+ |
| GET | `/people`, `/destinations` | viewer+, kiosk (names only) |
| POST/PATCH/PUT | `/people`, `/people/:id`, `/people/:id/pin` | admin+ |
| GET/POST | `/campuses`, `/rooms`, `/ministries` | viewer+ / admin+ |
| GET/POST | `/categories`, `/item-types`, `/custom-fields` | viewer+ / manager+ / admin+ |
| POST | `/kiosks/enrollments`, `/kiosks/:id/revoke`; GET `/kiosks` | admin+ |
| POST | `/kiosks/enroll`, `/kiosks/token` | device (unauthenticated, rate-limited) |
| GET | `/stats`, `/audit` | viewer+ |
| * | `/auth/*`, `/me` | — |

Full schemas: run the API and open `/docs`.
