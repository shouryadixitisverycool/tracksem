import type { RequestHandler } from './$types';
import { authorizationServerMetadata, metadataJson, preflight } from '$lib/server/oauth';

/** RFC 8414 authorization server metadata */
export const GET: RequestHandler = ({ url }) => metadataJson(authorizationServerMetadata(url));
export const OPTIONS: RequestHandler = () => preflight();
