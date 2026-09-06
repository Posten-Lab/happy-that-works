import { query, type ModelInfo, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

export function mapClaudeModels(models: ModelInfo[]) {
    return models.map((model) => ({
        // Keep the advertised selector, including context suffixes and aliases.
        code: model.value,
        value: model.displayName,
        description: model.description,
        isDefault: model.value === 'default',
        supportedReasoningEfforts: model.supportedEffortLevels?.map((effort) => ({
            code: effort,
            value: effort,
        })) ?? (model.supportsEffort ? undefined : []),
    }));
}

/** Read the same Claude SDK catalog used by Happy sessions, without submitting a turn. */
export async function discoverClaudeModels() {
    let releaseInput!: () => void;
    const inputClosed = new Promise<void>((resolve) => { releaseInput = resolve; });
    async function* idleInput(): AsyncGenerator<SDKUserMessage> {
        await inputClosed;
    }

    const controller = new AbortController();
    const client = query({
        prompt: idleInput(),
        options: {
            abortController: controller,
            persistSession: false,
            settingSources: ['user'],
            tools: [],
            mcpServers: {},
            strictMcpConfig: true,
        },
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        const models = await Promise.race([
            client.supportedModels(),
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error('Claude model discovery timed out')), 15_000);
            }),
        ]);
        return mapClaudeModels(models);
    } finally {
        clearTimeout(timeout);
        releaseInput();
        controller.abort();
        client.close();
    }
}
