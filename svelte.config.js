import adapter from '@sveltejs/adapter-node';

/** Serve under a sub-path such as /tracksem (baked in at build time); empty means the root */
const basePath = (process.env.TRACKSEM_BASE_PATH ?? '').replace(/\/+$/, '');

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		paths: { base: basePath },
		// The same-origin check for form posts lives in hooks.server.ts instead, because OAuth
		// clients post form-encoded bodies to /oauth/token server-to-server without an Origin header.
		csrf: { trustedOrigins: ['*'] }
	}
};

export default config;
