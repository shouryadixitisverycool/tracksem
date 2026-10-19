import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_CREDITS, DEFAULT_COURSES, SEM_DATA } from './courses.ts';

const catalog = Object.values(SEM_DATA).flatMap((branch) => Object.values(branch).flat());
const catalogIds = new Set(catalog.map((course) => course.id));

test('every DEFAULT_COURSES template id exists in SEM_DATA', () => {
	for (const template of DEFAULT_COURSES) {
		assert.ok(catalogIds.has(template.id), `${template.id} (${template.name}) is not in SEM_DATA`);
	}
});

test('templates have components whose weights sum to at most 100', () => {
	for (const template of DEFAULT_COURSES) {
		assert.ok(template.components.length > 0, `${template.id} has no components`);
		const total = template.components.reduce((sum, comp) => sum + comp.weight, 0);
		assert.ok(total <= 100, `${template.id} weights sum to ${total}`);
	}
});

test('credits are only listed for catalog ids', () => {
	for (const id of Object.keys(COURSE_CREDITS)) {
		assert.ok(catalogIds.has(id), `credits listed for unknown id ${id}`);
	}
});
