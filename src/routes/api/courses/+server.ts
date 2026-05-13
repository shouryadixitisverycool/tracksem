import { json } from '@sveltejs/kit';
import { addCourseWithDefaults, deleteCourse, getCoursesBySemester, getAllCourses } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const semesterId = url.searchParams.get('semesterId');
	const courses = semesterId
		? await getCoursesBySemester(semesterId)
		: await getAllCourses();
	return json(courses);
};

/** POST /api/courses → add a new course with defaults */
export const POST: RequestHandler = async ({ request }) => {
	const { name, fullName, color, semesterId } = await request.json();
	if (!name || !fullName || !color) {
		return json({ error: 'Missing fields' }, { status: 400 });
	}

	const course = await addCourseWithDefaults(name, fullName, color, semesterId ?? undefined);
	return json(course);
};

/** DELETE /api/courses → delete a course */
export const DELETE: RequestHandler = async ({ request }) => {
	const { id } = await request.json();
	if (!id) {
		return json({ error: 'Missing id' }, { status: 400 });
	}

	await deleteCourse(id);
	return json({ ok: true });
};
