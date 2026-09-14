import * as React from 'react';
import { codexListModels, claudeListModels, museListModels, type ProviderModel } from '@/sync/ops';
import { useSocketStatus } from '@/sync/storage';

type Catalog = { machineId: string; provider: string; status: 'loading' | 'ready' | 'error'; models: ProviderModel[]; error: string };

/** Discovery used by setup wizards: expose failures and a bounded retry instead of an endless waiting label. */
export function useMachineModelCatalog(machineId: string | null, provider: 'codex' | 'claude' | 'muse' = 'codex') {
    const { status } = useSocketStatus();
    const [attempt, retry] = React.useReducer((n: number) => n + 1, 0);
    const [catalog, setCatalog] = React.useState<Catalog | null>(null);
    React.useEffect(() => {
        if (!machineId || status !== 'connected') { setCatalog(null); return; }
        let live = true;
        setCatalog({ machineId, provider, status: 'loading', models: [], error: '' });
        const timer = setTimeout(() => {
            if (live) { live = false; setCatalog({ machineId, provider, status: 'error', models: [], error: 'The machine did not return its selected provider models. Check that its daemon is running, then retry.' }); }
        }, 20000);
        void ({ codex: codexListModels, claude: claudeListModels, muse: museListModels }[provider])(machineId).then(result => {
            if (!live) return;
            clearTimeout(timer);
            if (result.type === 'success' && result.models.length) setCatalog({ machineId, provider, status: 'ready', models: result.models, error: '' });
            else setCatalog({ machineId, provider, status: 'error', models: [], error: result.type === 'error' ? result.errorMessage : 'This machine returned no models. Check the provider installation and sign-in, then retry.' });
        }).catch(error => {
            if (!live) return;
            clearTimeout(timer);
            setCatalog({ machineId, provider, status: 'error', models: [], error: error instanceof Error ? error.message : 'Model discovery failed. Retry after checking the machine.' });
        });
        return () => { live = false; clearTimeout(timer); };
    }, [machineId, provider, status, attempt]);
    const current = catalog?.machineId === machineId && catalog.provider === provider ? catalog : null;
    return { status: !machineId ? 'idle' as const : status !== 'connected' ? 'disconnected' as const : current?.status ?? 'loading' as const,
        models: current?.models ?? [], error: current?.error ?? '', retry };
}
