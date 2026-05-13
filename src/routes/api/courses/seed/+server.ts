import { seedByBranch } from "$lib/server/db";
import { getCourses } from "$lib/data/courses";
import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

/** POST /api/courses/seed  → seed courses from catalog for a branch + semester */
export const POST: RequestHandler = async ({ request }) => {
  const { branch, semester, semesterId } = await request.json();
  const coursesRequired = getCourses(branch, semester);
  if (coursesRequired.length === 0) {
    return json(
      {
        error:
          "No courses found for this branch and this semester. Please contact Teja Pudi :-)",
      },
      { status: 400 },
    );
  }

  if (!semesterId) {
    return json({ error: "Missing semesterId" }, { status: 400 });
  }

  const courses = await seedByBranch(coursesRequired, semesterId);

  return json(courses);
};
