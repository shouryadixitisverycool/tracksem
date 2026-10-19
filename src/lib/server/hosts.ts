/** Hostname part of a Host header or host[:port] entry, lowercased ("[::1]:3000" → "::1") */
export function hostnameOf(host: string): string {
	const value = host.trim().toLowerCase();
	if (value.startsWith('[')) {
		const end = value.indexOf(']');
		return end === -1 ? value : value.slice(1, end);
	}
	const colons = value.split(':').length - 1;
	const name = colons === 1 ? value.slice(0, value.indexOf(':')) : value;
	return name.replace(/\.$/, '');
}

/** localhost, ORIGIN's hostname, and comma-separated extra hosts (ports are ignored) */
export function buildAllowlist(origin: string | undefined, extraHosts: string | undefined): Set<string> {
	const hosts = new Set(['localhost', '127.0.0.1', '::1']);
	if (origin) {
		try {
			hosts.add(hostnameOf(new URL(origin).host));
		} catch {
			console.warn(`[tracksem] ignoring unparsable ORIGIN: ${origin}`);
		}
	}
	for (const entry of (extraHosts ?? '').split(',')) {
		if (entry.trim()) hosts.add(hostnameOf(entry));
	}
	return hosts;
}
