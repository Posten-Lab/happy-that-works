// Commit labels are OTA metadata, not native compatibility inputs.
module.exports = {
    fileHookTransform(source, chunk) {
        if (source.type === 'contents' && source.id === 'expoConfig' && chunk != null) {
            const config = JSON.parse(chunk.toString());
            if (config.extra?.app) {
                delete config.extra.app.buildCommitSha;
                delete config.extra.app.buildCommitTimestamp;
            }
            return JSON.stringify(config);
        }
        return chunk;
    },
};
