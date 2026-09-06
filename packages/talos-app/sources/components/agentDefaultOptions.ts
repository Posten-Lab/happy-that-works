import {
    getAvailableModels,
    getEffortLevelsForModel,
    type EffortLevel,
    type ModelMetadata,
    type ModelMode,
} from '@/components/modelModeOptions';
import type { AgentKey } from '@/sync/agentDefaults';

type Translate = (key: any) => string;

export function getAgentDefaultModelOptions(
    agent: AgentKey,
    providerMetadata: ModelMetadata | null | undefined,
    translate: Translate,
): ModelMode[] {
    return getAvailableModels(agent, providerMetadata, translate)
        .filter((option) => option.key !== 'default');
}

export function getAgentDefaultEffortOptions(
    agent: AgentKey,
    modelKey: string,
    providerMetadata: ModelMetadata | null | undefined,
): EffortLevel[] {
    return getEffortLevelsForModel(
        agent,
        modelKey,
        providerMetadata,
    );
}
