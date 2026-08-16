# System Plan — Course Platform

This is the master reference for how the whole system fits together: what each
service owns, how data flows, what's real vs in-memory right now, and how it
all deploys. See `API-CONTRACTS.md` for the exact endpoint specs.

---

## 1. Architecture at a glance

```
Client → Gateway → Auth Service
                 → Course Service
                 → Enrollment Service → Auth Service (sync verify)
                                      → Course Service (sync exists check)
                                      → Redis (async publish) → Notification Service
```

- **Gateway** is the only entry point clients talk to. It never contains
  business logic — just routing, rate limiting, and blocking internal-only
  endpoints.
- **Enrollment Service** is the "hub" — it's the only service that calls
  other services directly. Auth, Course, and Notification never call each
  other or call Enrollment back.
- **Redis** is the async boundary. Enrollment publishes and moves on;
  Notification consumes whenever it's ready. Neither knows the other exists
  beyond the event contract.

---

## 2. Service responsibilities

| Service | Owns | Talks to | Status |
|---|---|---|---|
| Gateway | Routing, rate limiting | Auth, Course, Enrollment (proxy only) | ✅ done |
| Auth | Users, credentials, JWTs | Nobody (leaf service) | ✅ done |
| Course | Courses, modules | Nobody (leaf service) | 🟡 building now |
| Enrollment | Enrollments, progress | Auth (sync), Course (sync), Redis (async) | ✅ done |
| Notification | Sending notifications | Redis (async, consumer only) | ✅ done |

A "leaf service" here means nothing upstream depends on it calling anyone
else — Auth and Course just answer questions, they don't ask any.

---

## 3. Data storage — current vs planned

This is worth being honest about: **only Course Service has a real
database right now.** Auth and Enrollment use in-memory arrays that reset
every time the service restarts. That was a deliberate shortcut to let us
focus on the auth flow and cross-service calls first, without database setup
slowing that down.

| Service | Current storage | Real DB planned | Resets on restart? |
|---|---|---|---|
| Auth | In-memory array (`users`) | Postgres or MySQL | Yes |
| Course | **MySQL** (`courses` table) | Already real | No |
| Enrollment | In-memory array (`enrollments`) | Postgres | Yes |
| Notification | In-memory array (`receivedNotifications`, debug only) | None needed — it's a consumer, not a source of truth | Yes |

### Course Service schema (the one real table so far)

```
courses
├── id            bigint, primary key
├── title         string
├── description   text, nullable
├── created_at    timestamp
└── updated_at    timestamp
```

### Planned schemas (not built yet — next upgrade path)

```
users (auth-service)                enrollments (enrollment-service)
├── id            uuid/bigint PK    ├── id              bigint PK
├── name           string           ├── user_id          references users
├── email           string, unique  ├── course_id        references courses
├── password_hash   string          ├── course_title     string (denormalized)
├── created_at       timestamp      ├── status            string
└── updated_at        timestamp     ├── progress           integer
                                     ├── enrolled_at         timestamp
                                     └── updated_at           timestamp
```

Moving Auth and Enrollment onto real databases is a good next milestone
after Course Service is finished — same pattern we just used for Course
(migration → model → controller → tests), just applied to two more services.

---

## 4. Request workflow — enrolling in a course

See the workflow diagram above for the visual version. In words:

1. Client sends `POST /enrollments` with a course ID and a bearer token, to
   the Gateway.
2. Gateway proxies the request to Enrollment Service unchanged.
3. Enrollment Service makes two **synchronous** calls before doing anything
   else — it needs both answers before it can proceed:
   - `GET /auth/verify` on Auth Service — is this token valid, and whose is it?
   - `GET /courses/:id/exists` on Course Service — does this course exist?
4. If both checks pass, Enrollment saves the record (with the course title
   copied in — denormalized, see `API-CONTRACTS.md` for why) and responds
   `201` to the client immediately.
5. Enrollment publishes an `enrollment.created` event to Redis —
   **asynchronously**, meaning it does not wait for this to succeed or for
   anyone to consume it. If Redis is down, the enrollment still succeeds.
6. Whenever Notification Service is ready, it consumes the event from Redis
   and logs/sends a welcome notification. This can happen milliseconds or
   minutes later — Enrollment doesn't know or care.

The key lesson embedded here: **sync = "I need the answer before I
continue," async = "this can happen without me waiting."** Steps 3 use sync
because an invalid token or missing course should stop the request. Step 5
uses async because a failed notification should never block someone from
successfully enrolling.

---

## 5. Deployment structure

`docker-compose.yml` at the repo root wires everything together for local
development:

```
redis            → port 6379
course-db (MySQL)   → port 3306
enrollment-db (Postgres) → port 5432   [not yet used by enrollment-service — still in-memory]
auth-service       → port 3001
course-service      → port 8000
enrollment-service   → port 3002
notification-service  → port 3003
gateway              → port 3000  ← clients hit this one
```

`enrollment-db` is already defined in `docker-compose.yml` for when
Enrollment Service moves off in-memory storage (see section 3) — it's not
being used yet.

---

## 6. CI/CD

- GitHub Actions workflow (`.github/workflows/ci.yml`) uses path-based
  filtering — only the service(s) whose folder changed get tested, not
  everything every push.
- Notification Service's CI job spins up a real Redis **service container**
  so pub/sub is tested against the real thing, not mocked.
- Course Service's CI job uses SQLite in-memory for tests — fast, no
  external database needed just to run `php artisan test`.
- No CD (deploy) step yet. Natural next step once all services are
  feature-complete: build + push Docker images to a registry (e.g. GHCR) on
  merge to `main`.

---

## 7. Build order / status

1. ✅ Auth Service
2. ✅ Enrollment Service
3. ✅ Notification Service
4. ✅ API Gateway
5. 🟡 Course Service — Laravel endpoints (in progress right now)
6. ⏳ Move Auth + Enrollment onto real databases (see section 3)
7. ⏳ Circuit breaker on Enrollment → Course calls (resilience)
8. ⏳ CD pipeline (build + push Docker images)
9. testing tesing