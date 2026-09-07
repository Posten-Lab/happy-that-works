import { ensureDaemonService } from './service';

export async function install(): Promise<void> {
    const result = await ensureDaemonService({ enable: true });
    if (!result.managed) throw new Error(result.message || 'Automatic background startup is disabled');
    console.log(result.message || 'Talos background service installed and started.');
}
