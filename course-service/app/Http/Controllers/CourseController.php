<?php

namespace App\Http\Controllers;

use App\Models\Course;
use Illuminate\Http\Request;

class CourseController extends Controller
{
    // GET /api/courses
    public function index()
    {
        $courses = Course::all()->map(function ($course) {
            return [
                'id' => $course->id,
                'title' => $course->title,
                'description' => $course->description,
                // No Module model yet - hardcoded to 0 for now. Swap this
                // for a real relationship count once modules exist.
                'modulesCount' => 0,
            ];
        });

        return response()->json($courses);
    }

    // GET /api/courses/{id}
    public function show($id)
    {
        $course = Course::find($id);

        if (! $course) {
            return response()->json([
                'error' => ['code' => 'COURSE_NOT_FOUND', 'message' => 'course not found'],
            ], 404);
        }

        return response()->json([
            'id' => $course->id,
            'title' => $course->title,
            'description' => $course->description,
            // Placeholder until a real Module model/relationship exists.
            'modules' => [],
        ]);
    }

    // POST /api/courses
    // NOTE: API-CONTRACTS.md marks this admin-only. Real admin-check
    // (verifying a JWT against Auth Service) is not wired up yet - this
    // is a good next upgrade once you're comfortable with the basics.
    public function store(Request $request)
    {
        $validated = $request->validate([
            'title' => 'required|string|max:255',
            'description' => 'nullable|string',
        ]);

        $course = Course::create($validated);

        return response()->json([
            'id' => $course->id,
            'title' => $course->title,
            'description' => $course->description,
        ], 201);
    }

    // GET /api/courses/{id}/exists - internal-only, called by Enrollment Service
    public function exists($id)
    {
        $course = Course::find($id);

        if (! $course) {
            return response()->json(['exists' => false], 404);
        }

        return response()->json(['exists' => true, 'title' => $course->title]);
    }
}