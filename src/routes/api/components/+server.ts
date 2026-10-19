import { json } from '@sveltejs/kit';
import { addComponent, updateComponentField, deleteComponent, reorderComponents } from '$lib/server/db';
import type { RequestHandler } from './$types';

/** POST /api/components → add a new component */
export const POST: RequestHandler = async ({ request }) => {
	const { courseId, id, name } = await request.json();
	await addComponent(courseId, id, name);
	return json({ ok: true });
};

/** PATCH /api/components → update a component field or course component order */
export const PATCH: RequestHandler = async ({ request }) => {
	const { id, field, value, courseId, order } = await request.json();
	if (order !== undefined) {
		if (typeof courseId !== 'string' || !courseId || !Array.isArray(order) || order.some((id) => typeof id !== 'string')) {
			return json({ error: 'Invalid component order' }, { status: 400 });
		}
		reorderComponents(courseId, order);
		return json({ ok: true });
	}
	await updateComponentField(id, field, value);
	return json({ ok: true });
};

/** DELETE /api/components → remove a component */
export const DELETE: RequestHandler = async ({ request }) => {
	const { id } = await request.json();
	await deleteComponent(id);
	return json({ ok: true });
};
