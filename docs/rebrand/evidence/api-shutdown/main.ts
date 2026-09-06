import { writeSync } from 'node:fs';
import { log } from './utils/log';
import { onShutdown, awaitShutdown } from './utils/shutdown';
const emit = (value: string) => writeSync(1, value + '\n');
const keeper = setInterval(() => {}, 1000);
process.on('SIGTERM', () => emit('PROBE_SIGTERM_RECEIVED'));
onShutdown('synthetic-delayed-work', async () => {
    emit('PROBE_HANDLER_BEGIN');
    await new Promise(resolve => setTimeout(resolve, 2000));
    emit('PROBE_HANDLER_END');
}, { phase: 'work' });
onShutdown('synthetic-keeper', async () => { clearInterval(keeper); }, { phase: 'resources' });
async function main() {
    log('Ready');
    emit('PROBE_READY');
    await awaitShutdown();
    emit('PROBE_DRAIN_RETURNED');
    log('Shutting down...');
}
main().then(() => process.exit(0)).catch(() => { emit('PROBE_FAILED'); process.exit(1); });
