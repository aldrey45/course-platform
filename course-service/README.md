# Course Service (Laravel)

This folder is intentionally empty except this README — Laravel needs to be
scaffolded locally where you have Composer/PHP installed.

## Setup

```bash
# from inside course-platform/
composer create-project laravel/laravel course-service-tmp
# then move its contents into this course-service/ folder
# (or just run the composer command directly inside an empty course-service/)
```

Or, simpler — delete this README and run directly inside this folder:

```bash
cd course-service
composer create-project laravel/laravel .
```

## After scaffolding, implement per API-CONTRACTS.md

- `GET  /api/courses`
- `GET  /api/courses/:id`
- `POST /api/courses` (admin only)
- `GET  /api/courses/:id/exists` — **internal-only**, do not expose through Gateway

## .env additions needed

```
DB_CONNECTION=mysql
DB_HOST=course-db
DB_PORT=3306
DB_DATABASE=course_db
DB_USERNAME=course_user
DB_PASSWORD=course_pass
```

## Dockerfile

A `Dockerfile` is NOT included yet since it depends on your final Laravel
structure. Once scaffolded, a standard `php:8.3-fpm` + nginx or
`serversideup/php` image works well. Ask Claude to generate one once the
Laravel app exists — this is a good next step after CI/CD is wired up.
