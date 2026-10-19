import { json } from '@sveltejs/kit';
import { addCourseWithDefaults, deleteCourse, getCoursesBySemester, getAllCourses, updateCourseClassSize, updateCourseGradeVisibility } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const semesterId = url.searchParams.get('semesterId');
	const courses = semesterId
		? await getCoursesBySemester(semesterId)
		: await getAllCourses();
	return json(courses);
};

export const PATCH: RequestHandler = async ({ request }) => {
	const { id, field, hidden, value } = await request.json();
	if (field === 'classSize') {
		if (typeof id !== 'string' || !id ||
			(value !== null && !(Number.isInteger(value) && value > 0))) {
			return json({ error: 'Invalid class size' }, { status: 400 });
		}
		if (!updateCourseClassSize(id, value)) {
			return json({ error: 'Course not found' }, { status: 404 });
		}
		return json({ ok: true });
	}
	if (typeof id !== 'string' || !id ||
		(field !== 'hideAbsoluteGrade' && field !== 'hideRelativeGrade') ||
		typeof hidden !== 'boolean') {
		return json({ error: 'Invalid grade visibility settings' }, { status: 400 });
	}
	if (!updateCourseGradeVisibility(id, field, hidden)) {
		return json({ error: 'Course not found' }, { status: 404 });
	}
	return json({ ok: true });
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
