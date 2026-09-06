/** Owned native-store identifiers survive display-name changes and app updates.
 * Keep these compatibility values out of product labels. Signing must retain
 * the same application identifier prefix and keychain access group as 1.7.0.
 */
const productionStoreIdentity = Object.freeze({
    applicationId: 'com.ahposten.happyimproved',
    legacyScheme: 'happy',
    easProjectId: '4445e993-5eaa-4a1a-8754-7068e8565e64',
    easSlug: 'happy-improved',
    expoOwner: 'posten-lab',
    appleTeamId: 'H2XR8XWZXW',
    ascAppId: '6787151946',
});

function applicationIdForVariant(variant) {
    const applicationId = {
        production: productionStoreIdentity.applicationId,
        development: 'com.ahposten.talos.dev',
        preview: 'com.ahposten.talos.preview',
    }[variant];
    if (!applicationId) throw new Error('APP_ENV must be development, preview, or production.');
    return applicationId;
}

module.exports = { productionStoreIdentity, applicationIdForVariant };
