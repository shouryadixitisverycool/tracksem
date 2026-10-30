import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** GET /api/health → used by the Docker healthcheck; needs no session */
export const GET: RequestHandler = async () => json({ ok: true });
