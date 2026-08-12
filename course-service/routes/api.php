<?php

use App\Http\Controllers\CourseController;
use Illuminate\Support\Facades\Route;

Route::get('/courses', [CourseController::class, 'index']);
Route::get('/courses/{id}', [CourseController::class, 'show']);
Route::post('/courses', [CourseController::class, 'store']);

// Internal-only - called by Enrollment Service, never proxied through
// the Gateway (see API-CONTRACTS.md and gateway/src/index.js blockers).
Route::get('/courses/{id}/exists', [CourseController::class, 'exists']);