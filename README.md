# Course Platform — Microservices Practice Project

See `API-CONTRACTS.md` for the full API design and `SYSTEM-PLAN.md` for the
architecture, workflow, and data storage overview.

## Status: ✅ All 5 services complete, CI green, full end-to-end flow verified

| Service | Stack | Status |
|---|---|---|
| Gateway | Node.js + Express | ✅ done |
| Auth Service | Node.js + Express + JWT | ✅ done |
| Course Service | Laravel + MySQL | ✅ done |
| Enrollment Service | Node.js + Express | ✅ done |
| Notification Service | Node.js + Redis pub/sub | ✅ done |

## Structure

```
course-platform/
├── auth-service/          Node.js + Express + JWT
├── course-service/        Laravel (MySQL)
├── enrollment-service/    Node.js + Express
├── notification-service/  Node.js + Redis pub/sub consumer
├── gateway/                Node.js + Express (reverse proxy + rate limit)
├── docker-compose.yml
├── API-CONTRACTS.md       Endpoint specs, event contracts, design decisions
├── SYSTEM-PLAN.md          Architecture, workflow, data storage overview
└── .github/workflows/ci.yml
```

## Running the whole stack

**Start everything in the background** (recommended — doesn't tie up a
terminal, survives you closing the window):

```bash
docker compose up -d
```

**Check everything is up:**

```bash
docker compose ps
```

You should see 8 containers, all status "Up": `gateway`, `auth-service`,
`course-service`, `enrollment-service`, `notification-service`, `redis`,
`course-db`, `enrollment-db`.

**First time only** — the `courses` table needs to be migrated inside the
running container:

```bash
docker compose exec course-service php artisan migrate
```

**View logs** (all services, live):

```bash
docker compose logs -f
```

Or just one service:

```bash
docker compose logs -f course-service
```

**Stop everything:**

```bash
docker compose down
```

(Data in `course-db` and `enrollment-db` persists across restarts thanks to
the named volumes in `docker-compose.yml` — `down` alone won't wipe it. Add
`-v` to `docker compose down -v` if you want a totally clean slate.)

**After changing a Dockerfile or dependencies**, rebuild:

```bash
docker compose up -d --build
```

## Manual end-to-end test (PowerShell)

Once the stack is up and migrated, this walks a request through the whole
system — register → login → create a course → enroll → confirm the async
notification fired. Run each block separately (don't paste multi-line
blocks as one command — PowerShell needs Enter between statements).

```powershell
# 1. Register
$register = Invoke-RestMethod -Uri http://localhost:3000/auth/register -Method Post -ContentType "application/json" -Body '{"name":"Test User","email":"test@example.com","password":"password123"}'
$register

# 2. Login
$login = Invoke-RestMethod -Uri http://localhost:3000/auth/login -Method Post -ContentType "application/json" -Body '{"email":"test@example.com","password":"password123"}'
$token = $login.token

# 3. Create a course
$course = Invoke-RestMethod -Uri http://localhost:3000/courses -Method Post -ContentType "application/json" -Body '{"title":"Intro to Microservices","description":"Learn the basics"}'
$course

# 4. Enroll (this triggers sync calls to Auth + Course, then an async event)
$headers = @{ Authorization = "Bearer $token" }
$enroll = Invoke-RestMethod -Uri http://localhost:3000/enrollments -Method Post -ContentType "application/json" -Headers $headers -Body (@{ courseId = $course.id } | ConvertTo-Json)
$enroll

# 5. See your enrollments
Invoke-RestMethod -Uri http://localhost:3000/enrollments/me -Headers $headers

# 6. Confirm the Notification Service consumed the event (direct port, not through Gateway)
Invoke-RestMethod -Uri http://localhost:3003/notifications
```

If step 6 shows your enrollment with a `receivedAt` timestamp a few
milliseconds after `enrolledAt`, the whole async event pipeline (Enrollment
→ Redis → Notification) is working correctly.

## Troubleshooting

Issues actually hit while building this, in case they come back:

- **`docker compose up` fails with "Cannot find module .../src/index.js"
  or a PHP mass-assignment/undefined-method error on a fresh clone** — a
  file (often a Dockerfile, controller, or model) ended up empty or with
  the wrong content after a copy-paste. Check the file's actual contents;
  don't assume it saved correctly.
- **Course Service ignores your `.env` values (e.g. still tries SQLite even
  though `.env` says MySQL)** — check `docker-compose.yml`'s `env_file` for
  `course-service` points at `.env`, **not** `.env.example`. Docker sets
  those as OS-level environment variables before Laravel boots, and Laravel
  does not override already-set environment variables with its own `.env`
  file. This bit us once — `.env.example` still had the original SQLite
  defaults, so the container silently used those instead of the real config.
- **`bootstrap/cache` permission/writable errors on Windows** — if the
  project lives inside a OneDrive-synced folder, move it outside OneDrive
  entirely (e.g. `C:\Users\<you>\course-platform`). OneDrive sync can mark
  files/folders read-only or interfere with Laravel's cache writes.
- **`git status` shows a folder as missing after deleting its only file**
  (e.g. `tests/Unit/` after removing `ExampleTest.php`) — Git doesn't track
  empty directories. Add a `.gitkeep` placeholder file to keep it tracked.
- **Node test script `node --test tests/` fails to find the directory** —
  use `node --test tests/*.test.js` instead (glob pattern, not a bare
  directory) — this was a consistent quirk across all 4 Node services here.

## CI/CD status

- ✅ **CI**: `.github/workflows/ci.yml` — path-filtered per service, runs
  tests only for what changed. Notification Service's job spins up a real
  Redis service container; Auth and Enrollment Services' jobs spin up real
  Postgres service containers; Course Service's job uses SQLite in-memory.
- ✅ **CD**: on every push to `main`, once a service's tests pass, its
  Docker image is built and pushed to GitHub Container Registry (GHCR),
  tagged both `latest` and with the commit SHA. Only runs for services
  that actually changed (same path-filtering as CI) and only on `main`
  pushes, never on pull requests.

Published images live at:

```
ghcr.io/aldrey45/course-platform-auth-service
ghcr.io/aldrey45/course-platform-enrollment-service
ghcr.io/aldrey45/course-platform-notification-service
ghcr.io/aldrey45/course-platform-gateway
ghcr.io/aldrey45/course-platform-course-service
```

To pull and run a published image directly (instead of building locally):

```bash
docker pull ghcr.io/aldrey45/course-platform-auth-service:latest
docker run -p 3001:3001 --env-file auth-service/.env.example ghcr.io/aldrey45/course-platform-auth-service:latest
```

(First push, images are private by default under your GitHub account's
package settings — visit github.com/aldrey45?tab=packages to make one
public if you want to pull it without authenticating.)

## Natural next steps

1. Move Auth Service and Enrollment Service off in-memory storage onto real
   databases (see `SYSTEM-PLAN.md` section 3 for the planned schemas).
2. Add a circuit breaker on Enrollment → Course Service calls for
   resilience when a downstream service is slow or down.
3. Build a CD pipeline.