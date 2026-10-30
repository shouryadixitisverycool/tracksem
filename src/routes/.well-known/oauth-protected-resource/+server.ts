import type { RequestHandler } from './$types';
import { metadataJson, preflight, protectedResourceMetadata } from '$lib/server/oauth';

/** RFC 9728 protected resource metadata */
export const GET: RequestHandler = ({ url }) => metadataJson(protectedResourceMetadata(url));
export const OPTIONS: RequestHandler = () => preflight();
