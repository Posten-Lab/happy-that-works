/**
 * Document / file picker for the composer. Wraps expo-document-picker so
 * users can attach PDFs, source files, videos-from-Files.app, and anything
 * else — the CLI's attachmentRouter dispatches each MIME to the right
 * Anthropic content-block form (image / document / `@path`).
 *
 * Photo/video-library attachments still go through `useImagePicker`.
 * `useDocumentPicker` handles the "arbitrary file from Files.app" path.
 */
import { useCallback } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { Modal } from '@/modal';
import { t } from '@/text';
import type { AttachmentPreview } from '@/sync/attachmentTypes';
import { MAX_FILE_SIZE, MAX_IMAGES_PER_MESSAGE } from './useImagePicker';

type UseDocumentPickerResult = {
    /** Picks 1..N files, size-guards each, and appends via addImages. */
    pickDocuments: () => Promise<void>;
};

export function useDocumentPicker(opts: {
    currentCount: number;
    addImages: (attachments: AttachmentPreview[]) => void;
}): UseDocumentPickerResult {
    const { currentCount, addImages } = opts;

    const pickDocuments = useCallback(async () => {
        const remaining = MAX_IMAGES_PER_MESSAGE - currentCount;
        if (remaining <= 0) {
            Modal.alert(
                t('imageUpload.limitTitle'),
                t('imageUpload.limitMessage', { max: MAX_IMAGES_PER_MESSAGE }),
                [{ text: t('common.ok') }],
            );
            return;
        }

        // We accept anything; the CLI router handles the type switch.
        const result = await DocumentPicker.getDocumentAsync({
            type: '*/*',
            copyToCacheDirectory: true, // required to read bytes reliably on iOS
            multiple: true,
        });

        if (result.canceled) return;
        const assets = result.assets.slice(0, remaining);
        const previews: AttachmentPreview[] = [];

        for (const asset of assets) {
            const size = asset.size ?? 0;
            if (size > MAX_FILE_SIZE) {
                Modal.alert(
                    t('imageUpload.fileTooLargeTitle'),
                    t('imageUpload.fileTooLargeMessage', { name: asset.name ?? 'file', maxMb: 100 }),
                    [{ text: t('common.ok') }],
                );
                continue;
            }
            const mimeType = asset.mimeType ?? 'application/octet-stream';
            const isImage = mimeType.startsWith('image/');
            previews.push({
                id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
                uri: asset.uri,
                width: 0,
                height: 0,
                mimeType,
                size,
                name: asset.name ?? 'file',
                // No thumbhash — expo-document-picker doesn't hand us pixel
                // data. Images picked via Files.app still render inline in
                // FileView; they just fetch-and-decode on mount instead of
                // showing a blurry placeholder first.
                isFile: !isImage,
                status: 'pending',
            });
        }

        if (previews.length > 0) {
            addImages(previews);
        }
    }, [currentCount, addImages]);

    return { pickDocuments };
}
