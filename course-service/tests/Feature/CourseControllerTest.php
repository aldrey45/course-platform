<?php

namespace Tests\Feature;

use App\Models\Course;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CourseControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_index_returns_all_courses(): void
    {
        Course::create(['title' => 'Intro to Testing', 'description' => 'Learn the basics']);
        Course::create(['title' => 'Advanced Docker', 'description' => 'Containers deep dive']);

        $response = $this->getJson('/api/courses');

        $response->assertStatus(200);
        $response->assertJsonCount(2);
        $response->assertJsonFragment(['title' => 'Intro to Testing']);
    }

    public function test_show_returns_a_single_course(): void
    {
        $course = Course::create(['title' => 'Intro to Testing', 'description' => 'Learn the basics']);

        $response = $this->getJson("/api/courses/{$course->id}");

        $response->assertStatus(200);
        $response->assertJson([
            'id' => $course->id,
            'title' => 'Intro to Testing',
        ]);
    }

    public function test_show_returns_404_for_missing_course(): void
    {
        $response = $this->getJson('/api/courses/999');

        $response->assertStatus(404);
        $response->assertJsonPath('error.code', 'COURSE_NOT_FOUND');
    }

    public function test_store_creates_a_new_course(): void
    {
        $response = $this->postJson('/api/courses', [
            'title' => 'New Course',
            'description' => 'A brand new course',
        ]);

        $response->assertStatus(201);
        $response->assertJsonFragment(['title' => 'New Course']);
        $this->assertDatabaseHas('courses', ['title' => 'New Course']);
    }

    public function test_store_validates_required_title(): void
    {
        $response = $this->postJson('/api/courses', ['description' => 'Missing a title']);

        $response->assertStatus(422);
    }

    public function test_exists_returns_true_for_existing_course(): void
    {
        $course = Course::create(['title' => 'Intro to Testing']);

        $response = $this->getJson("/api/courses/{$course->id}/exists");

        $response->assertStatus(200);
        $response->assertJson(['exists' => true, 'title' => 'Intro to Testing']);
    }

    public function test_exists_returns_404_for_missing_course(): void
    {
        $response = $this->getJson('/api/courses/999/exists');

        $response->assertStatus(404);
        $response->assertJson(['exists' => false]);
    }
}