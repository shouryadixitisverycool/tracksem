export type SaveState = 'idle' | 'saving' | 'error';

export type SaveRequest = { path: string; method: string; body?: unknown };

export type SaveFailure = { key: string; request: SaveRequest; message: string };

const RETRY_DELAY_MS = 800;

function isPermanentFailure(status: number): boolean {
    return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Debounced, ordered persistence for optimistic UI edits.
 * Each key (entity + field) keeps only its latest pending value; once its debounce
 * expires the request joins a single FIFO chain, so writes land in the order they
 * were committed and a create always reaches the server before later edits.
 */
export class SaveQueue {
    /** Writes scheduled or in flight */
    pending = $state(0);
    failures = $state<SaveFailure[]>([]);

    #scheduled = new Map<string, { timer: ReturnType<typeof setTimeout>; request: SaveRequest }>();
    #chain: Promise<void> = Promise.resolve();

    get state(): SaveState {
        if (this.failures.length > 0) return 'error';
        return this.pending > 0 ? 'saving' : 'idle';
    }

    enqueue(key: string, request: SaveRequest, delayMs = 300): void {
        const existing = this.#scheduled.get(key);
        if (existing) clearTimeout(existing.timer);
        else this.pending++;
        this.#scheduled.set(key, { request, timer: setTimeout(() => this.#flush(key), delayMs) });
    }

    /** Send every debounced write now and resolve once the chain is empty */
    async idle(): Promise<void> {
        for (const key of [...this.#scheduled.keys()]) this.#flush(key);
        let chain: Promise<void>;
        do {
            chain = this.#chain;
            await chain;
        } while (chain !== this.#chain);
    }

    retry(): void {
        const failures = this.failures;
        this.failures = [];
        for (const failure of failures) this.enqueue(failure.key, failure.request, 0);
    }

    dismiss(): void {
        this.failures = [];
    }

    #flush(key: string): void {
        const entry = this.#scheduled.get(key);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.#scheduled.delete(key);
        this.#chain = this.#chain
            .then(() => this.#send(key, entry.request))
            .finally(() => {
                this.pending--;
            });
    }

    async #send(key: string, request: SaveRequest): Promise<void> {
        let message = 'network error';
        for (let attempt = 0; attempt < 2; attempt++) {
            if (attempt > 0) await sleep(RETRY_DELAY_MS);
            try {
                const res = await fetch(request.path, {
                    method: request.method,
                    headers: request.body !== undefined ? { 'Content-Type': 'application/json' } : {},
                    body: request.body !== undefined ? JSON.stringify(request.body) : undefined
                });
                if (res.ok) {
                    this.failures = this.failures.filter((failure) => failure.key !== key);
                    return;
                }
                const data = (await res.json().catch(() => null)) as { error?: string } | null;
                message = data?.error ?? `server responded ${res.status}`;
                if (isPermanentFailure(res.status)) break;
            } catch {
                message = 'network error';
            }
        }
        this.failures = [...this.failures.filter((failure) => failure.key !== key), { key, request, message }];
    }
}
