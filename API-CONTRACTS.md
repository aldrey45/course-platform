# API Contracts — Online Course Platform (Microservices)

Reference doc for all services before implementation. Update this first if a contract needs to change — code should follow the doc, not the other way around.

---

## Services Overview

| Service | Stack | Port | Owns |
|---|---|---|---|
| API Gateway | Node.js + Express | 3000 | Routing, auth forwarding, rate limiting |
| Auth Service | Node.js + Express + JWT | 3001 | Users, credentials, tokens |
| Course Service | Laravel | 8000 | Courses, modules, content |
| Enrollment Service | Node.js + Express | 3002 | Enrollments, progress |
| Notification Service | Node.js + BullMQ/Redis | 3003 | Async notifications (event consumer only) |

---

## Auth Service (`:3001`)

| Method | Endpoint | Request Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{ name, email, password }` | `{ id, name, email }` |
| POST | `/auth/login` | `{ email, password }` | `{ token, expiresIn }` |
| GET | `/auth/verify` | Header: `Authorization: Bearer <token>` | `{ valid, userId, email }` — internal use by other services |
| GET | `/auth/me` | Header: `Authorization: Bearer <token>` | `{ id, name, email }` |

---

## Course Service — Laravel (`:8000`)

| Method | Endpoint | Request Body | Response |
|---|---|---|---|
| GET | `/api/courses` | — | `[{ id, title, description, modulesCount }]` |
| GET | `/api/courses/:id` | — | `{ id, title, description, modules: [...] }` |
| POST | `/api/courses` | `{ title, description }` (auth: admin) | `{ id, title, description }` |
| GET | `/api/courses/:id/exists` | — | `{ exists: true, title }` — internal use by Enrollment service |

---

## Enrollment Service (`:3002`)

| Method | Endpoint | Request Body | Response |
|---|---|---|---|
| POST | `/enrollments` | `{ courseId }` + Bearer token | `{ id, userId, courseId, status, enrolledAt }` |
| GET | `/enrollments/me` | Bearer token | `[{ id, courseId, courseTitle, status, progress }]` |
| PATCH | `/enrollments/:id/progress` | `{ percent }` | `{ id, progress }` |

**Internal behavior on `POST /enrollments`:**
1. Call Auth `/auth/verify` (sync) — confirm token is valid.
2. Call Course `/api/courses/:id/exists` (sync) — confirm course exists, get title.
3. Save enrollment record (denormalized `courseTitle` stored here for fast reads).
4. Publish `enrollment.created` event (async) — do not wait for consumers.

---

## Notification Service (`:3003`)

No public REST endpoints. Pure event consumer.

- Subscribes to channel: `enrollment.created`
- Action: send welcome message (console log / email stub for now)

---

## Event Contracts (Async)

### `enrollment.created`
```json
{
  "userId": "uuid",
  "courseId": "uuid",
  "courseTitle": "string",
  "enrolledAt": "ISO timestamp"
}
```

---

## Design Decisions (deliberate, not accidental)

- **Denormalization:** Enrollment service stores `courseTitle` alongside `courseId` so `/enrollments/me` doesn't need a live call to Course service on every read. This is an eventual-consistency tradeoff — if a course title changes, enrollment records won't reflect it until re-synced (acceptable for this learning project).
- **Internal-only endpoints:** `/auth/verify` and `/courses/:id/exists` are for service-to-service calls only. They should NOT be exposed through the API Gateway to the frontend.
- **Sync vs Async:** Anything the caller needs an immediate answer for (auth check, course existence) is synchronous HTTP. Anything that can happen in the background (notifications) is event-driven.
- **Auth strategy:** All services trust JWTs issued by Auth Service. Shared secret key for verification (simple, sufficient for learning — public/private key signing would be the production-grade next step).

---

## Open items to decide before coding

- [ ] Shared JWT secret — where does it live? (`.env` per service, same value)
- [ ] Message broker choice: Redis pub/sub (simpler) vs RabbitMQ (more realistic, has retry/dead-letter support)
- [ ] Error response shape — standardize across all services, e.g. `{ error: { code, message } }`
