import { subscribeUserChanges } from '$lib/server/events';
import type { RequestHandler } from './$types';

const DEBOUNCE_MS = 300;
const PING_MS = 25_000;

/** GET /api/events → Server-Sent Events; sends `change` when the user's data changes outside this tab */
export const GET: RequestHandler = ({ locals, request }) => {
	const userId = locals.user!.id;
	const encoder = new TextEncoder();
	let cleanup = () => {};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			// A timer can fire after the stream closed; throwing there would crash the process
			const send = (text: string) => {
				try {
					controller.enqueue(encoder.encode(text));
				} catch {
					cleanup();
				}
			};
			let debounce: ReturnType<typeof setTimeout> | null = null;

			const unsubscribe = subscribeUserChanges(userId, () => {
				if (debounce) clearTimeout(debounce);
				debounce = setTimeout(() => {
					debounce = null;
					send('event: change\ndata: {}\n\n');
				}, DEBOUNCE_MS);
			});
			const ping = setInterval(() => send(': ping\n\n'), PING_MS);

			cleanup = () => {
				if (debounce) clearTimeout(debounce);
				clearInterval(ping);
				unsubscribe();
			};
			request.signal.addEventListener('abort', () => {
				cleanup();
				try {
					controller.close();
				} catch {
					// already cancelled
				}
			}, { once: true });
			send(': connected\n\n');
		},
		cancel() {
			cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
