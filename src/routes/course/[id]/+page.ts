import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
    // The root layout provides account-scoped courses for SSR and hydration.
    // The page handles missing courses and client-side lookups through its store.
    return { courseId: params.id };
};
