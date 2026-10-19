import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	return {
		user: {
			email: 'local sqlite'
		}
	};
};
