import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
    // The layout loads courses in the browser before rendering this page.
    // The store is empty during SSR and cannot validate the route here.
    return { courseId: params.id };
};
