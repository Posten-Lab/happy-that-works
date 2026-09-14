import { AGENT_DOCUMENT_MAX_CHARACTERS, AgentDocumentSchema } from '@ahmadposten/talos-wire';

/** Check byte size before reading; the saved reference limit counts characters. */
export async function readAgentDocument(asset: { name: string; size?: number }, read: () => Promise<string>) {
    if (!/\.(md|markdown|txt)$/i.test(asset.name)) throw new Error('Choose a Markdown (.md) or text (.txt) file.');
    if (asset.name.length > 120) throw new Error('Shorten the filename to 120 characters or fewer.');
    if ((asset.size ?? 0) > AGENT_DOCUMENT_MAX_CHARACTERS * 4) throw new Error('File is too large. Choose a file with at most 64,000 characters (256 KB maximum).');
    const content = await read();
    const result = AgentDocumentSchema.safeParse({ name: asset.name, content });
    if (!result.success) throw new Error(result.error.issues[0].message);
    return result.data;
}
