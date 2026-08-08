# Course Platform — Microservices Practice Project

See `API-CONTRACTS.md` for the full API design and design decisions.

## Structure

```
course-platform/
├── auth-service/          Node.js + Express + JWT
├── course-service/        Laravel (scaffold locally, see its README)
├── enrollment-service/    Node.js + Express
├── notification-service/  Node.js + Redis pub/sub consumer
├── gateway/                Node.js + Express (reverse proxy + rate limit)
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## Before your first run

1. Scaffold Laravel inside `course-service/` (see `course-service/README.md`)
   and add a `Dockerfile` for it.
2. For each Node service: `cd <service> && npm install` — this generates
   `package-lock.json`, which the CI workflow needs for its dependency cache.
3. Copy each `.env.example` to `.env` and adjust as needed.
4. Commit and push to GitHub, then check the **Actions** tab — you should
   see `detect-changes` run, and only the job(s) for the folder(s) you
   touched should run alongside it.

## Local dev

```bash
docker compose up --build
```

Gateway will be at `http://localhost:3000`. Individual services are also
exposed on their own ports for direct testing (see docker-compose.yml).

## CI/CD status

- ✅ **CI**: `.github/workflows/ci.yml` — path-filtered per service, runs
  tests only for what changed.
- ⏳ **CD**: not yet implemented. Natural next step once services have real
  logic: build + push Docker images to a registry (e.g. GHCR) on merge to
  `main`, tagged per service (`auth-service:sha`, etc).

## Build order (see API-CONTRACTS.md for endpoint specs)

1. Auth Service
2. Course Service (Laravel)
3. Enrollment Service
4. API Gateway
5. Notification Service (event-driven)
6. Resilience (circuit breaker on Enrollment → Course calls)
