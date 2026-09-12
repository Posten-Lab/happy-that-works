import { cacheDirectory, makeDirectoryAsync, readAsStringAsync, writeAsStringAsync, deleteAsync, getInfoAsync } from 'expo-file-system/legacy';

/** Only authenticated ciphertext is written by the coordinator. Cache files are
 * disposable, account/server scoped, and excluded from device cloud backups.
 */
export function createSearchCache(namespace: string) {
    const directory = `${cacheDirectory}session-search/${encodeURIComponent(namespace)}/`;
    const location = (key: string) => `${directory}${encodeURIComponent(key)}.json`;
    return {
        async get(key: string): Promise<string | null> {
            if (!cacheDirectory || !(await getInfoAsync(location(key))).exists) return null;
            return readAsStringAsync(location(key));
        },
        async set(key: string, value: string) {
            if (!cacheDirectory) throw new Error('Search cache storage unavailable');
            await makeDirectoryAsync(directory, { intermediates: true });
            await writeAsStringAsync(location(key), value);
        },
        async remove(key: string) { await deleteAsync(location(key), { idempotent: true }); },
        async clear() { await deleteAsync(directory, { idempotent: true }); },
    };
}
