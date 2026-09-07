import { uninstallDaemonService } from './service';
import { stopDaemon } from './controlClient';

export async function uninstall(): Promise<void> {
    await uninstallDaemonService();
    await stopDaemon();
    console.log('Automatic background startup disabled. Run talos daemon install to enable it again.');
}
