import { getAllSemesters, getEveryCourse } from '$lib/server/db';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, setHeaders }) => {
	// The HTML and serialized snapshot contain this account's private grades.
	setHeaders({ 'cache-control': 'private, no-store' });
	const user = locals.user;
	return {
		user,
		grades: user ? {
			semesters: getAllSemesters(user.id),
			courses: getEveryCourse(user.id)
		} : null
	};
};
