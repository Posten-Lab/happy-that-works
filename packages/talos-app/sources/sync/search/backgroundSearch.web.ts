import type { AuthCredentials } from '@/auth/tokenStorage';
import { sessionSearch } from './sessionSearch';

export function startSearchIndexing(_credentials: AuthCredentials) {
    void sessionSearch.start();
}
export async function stopSearchIndexing() { sessionSearch.stop(); }
