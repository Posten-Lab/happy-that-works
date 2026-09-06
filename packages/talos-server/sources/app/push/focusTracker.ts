/**
 * Checks whether a user is actively looking at any Talos client.
 *
 * "Active" means a user-facing app socket is connected AND has not reported
 * `app-state: background`. Agent session and daemon sockets are excluded.
 * Old user clients that never send `app-state` are treated as active
 * (connected = present) for backwards compatibility.
 *
 * State lives on `socket.data.appState` — set by the `app-state` socket
 * event in socket.ts. No external storage (Redis, Maps) needed: when a
 * socket disconnects the state disappears automatically.
 */

import { eventRouter } from "@/app/events/eventRouter";

export async function isUserActive(userId: string): Promise<boolean> {
    return eventRouter.hasActiveUserSocket(userId);
}
