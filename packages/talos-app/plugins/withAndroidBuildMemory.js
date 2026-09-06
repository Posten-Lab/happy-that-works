const { withGradleProperties } = require('@expo/config-plugins');

// The complete native module graph exceeds Expo's default 512 MB metaspace.
// Keep this in prebuild configuration so clean checkouts and EAS builds agree.
module.exports = function withAndroidBuildMemory(config) {
    return withGradleProperties(config, config => {
        const key = 'org.gradle.jvmargs';
        const value = process.env.TALOS_GRADLE_JVM_ARGS || '-Xmx4096m -XX:MaxMetaspaceSize=1536m';
        const property = config.modResults.find(item => item.type === 'property' && item.key === key);
        if (property) property.value = value;
        else config.modResults.push({ type: 'property', key, value });
        return config;
    });
};
