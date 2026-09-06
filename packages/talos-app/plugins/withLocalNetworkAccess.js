const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

// Development and preview builds can use an isolated relay on a laptop or LAN.
// Production builds retain Android's HTTPS requirement.
module.exports = function withLocalNetworkAccess(config, { allowCleartext = false } = {}) {
    return withAndroidManifest(config, config => {
        const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
        application.$['android:usesCleartextTraffic'] = String(allowCleartext);
        return config;
    });
};
