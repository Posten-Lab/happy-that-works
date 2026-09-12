/** IndexedDB avoids localStorage's small synchronous quota for conversation text.
 * Values passed here are encrypted; keys are scoped to the relay and account.
 */
export function createSearchCache(namespace: string) {
    let connection: Promise<IDBDatabase> | undefined;
    const open = () => connection ??= new Promise((resolve, reject) => {
        const request = indexedDB.open('talos-session-search-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('cache');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { connection = undefined; reject(request.error); };
    });
    const key = (value: string) => `${namespace}:${value}`;
    async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('cache', mode);
            const request = operation(tx.objectStore('cache'));
            tx.oncomplete = () => resolve(request.result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error('Search cache transaction aborted'));
        });
    }
    return {
        async get(name: string): Promise<string | null> { return (await transaction('readonly', store => store.get(key(name)))) ?? null; },
        async set(name: string, value: string) { await transaction('readwrite', store => store.put(value, key(name))); },
        async remove(name: string) { await transaction('readwrite', store => store.delete(key(name))); },
        async clear() {
            const names = await transaction('readonly', store => store.getAllKeys());
            for (const name of names) {
                if (typeof name === 'string' && name.startsWith(`${namespace}:`)) {
                    await transaction('readwrite', store => store.delete(name));
                }
            }
        },
    };
}
