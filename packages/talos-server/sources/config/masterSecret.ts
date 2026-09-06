/** Existing deployments can retain their secret while adopting the Talos environment name. */
export function getMasterSecret(): string {
    const secret = process.env.TALOS_MASTER_SECRET || process.env.HANDY_MASTER_SECRET;
    if (!secret) throw new Error('TALOS_MASTER_SECRET is required');
    return secret;
}
