import { text, type JsonObject } from './museProtocol';

// Temporary compatibility restriction verified against Muse 1.0.3.
export const museSupportedModel = 'muse-spark-1.3-contributor';
export const museSupportedProvider = 'meta';
export const museModelRestriction = 'Muse model changes are temporarily disabled to preserve resume and terminal handoff. Use a new session with muse-spark-1.3-contributor.';

export function assertMuseRoute(session: JsonObject) {
    if (text(session.modelId) !== museSupportedModel || text(session.providerId) !== museSupportedProvider) {
        throw new Error(museModelRestriction);
    }
}

export function assertMuseNativeArgs(args: string[]) {
    if (args.some(arg => ['--model', '-m', '--provider', '--profile'].some(flag => arg === flag || arg.startsWith(`${flag}=`)) || /^-m.+/.test(arg))) {
        throw new Error(museModelRestriction);
    }
}
