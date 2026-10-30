/** In-process change notifications so open tabs refetch after an agent edits their data */
type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeUserChanges(userId: string, listener: Listener): () => void {
	let set = listeners.get(userId);
	if (!set) listeners.set(userId, (set = new Set()));
	set.add(listener);
	return () => {
		set.delete(listener);
		if (set.size === 0) listeners.delete(userId);
	};
}

export function notifyUserChanged(userId: string): void {
	for (const listener of listeners.get(userId) ?? []) {
		try {
			listener();
		} catch {
			// a closed stream; its own cleanup removes it
		}
	}
}
