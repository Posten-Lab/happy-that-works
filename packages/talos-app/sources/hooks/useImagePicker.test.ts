import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    platform: { OS: 'ios' },
    requestMediaLibraryPermissionsAsync: vi.fn(),
    launchImageLibraryAsync: vi.fn(),
    manipulateAsync: vi.fn(),
    generateThumbhash: vi.fn(),
}));

vi.mock('react-native', () => ({
    Platform: mocks.platform,
}));

vi.mock('expo-image-picker', () => ({
    requestMediaLibraryPermissionsAsync: mocks.requestMediaLibraryPermissionsAsync,
    launchImageLibraryAsync: mocks.launchImageLibraryAsync,
}));

vi.mock('expo-image-manipulator', () => ({
    SaveFormat: { JPEG: 'jpeg' },
    manipulateAsync: mocks.manipulateAsync,
}));

vi.mock('@/modal', () => ({
    Modal: { alert: vi.fn() },
}));

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

vi.mock('@/utils/thumbhash', () => ({
    generateThumbhash: mocks.generateThumbhash,
}));

import { normalizePickedAssetForUpload } from './useImagePicker';

describe('normalizePickedAssetForUpload', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.platform.OS = 'ios';
    });

    it('normalizes iOS image picker assets to JPEG before upload', async () => {
        mocks.manipulateAsync.mockResolvedValue({
            uri: 'file:///tmp/ImageManipulator/IMG_9824.jpg',
            width: 4032,
            height: 3024,
        });

        const normalized = await normalizePickedAssetForUpload({
            uri: 'file:///tmp/IMG_9824.HEIC',
            width: 4032,
            height: 3024,
            fileName: 'IMG_9824.HEIC',
            fileSize: 2_701_533,
        });

        expect(mocks.manipulateAsync).toHaveBeenCalledWith(
            'file:///tmp/IMG_9824.HEIC',
            [],
            { compress: expect.any(Number), format: 'jpeg' },
        );
        expect(normalized).toEqual({
            uri: 'file:///tmp/ImageManipulator/IMG_9824.jpg',
            mimeType: 'image/jpeg',
            name: 'IMG_9824.jpg',
            width: 4032,
            height: 3024,
            isVideo: false,
        });
    });

    it('passes through video assets without invoking image manipulation', async () => {
        mocks.platform.OS = 'ios';

        const normalized = await normalizePickedAssetForUpload({
            uri: 'file:///tmp/PL_0001.MOV',
            width: 1920,
            height: 1080,
            fileName: 'PL_0001.MOV',
            fileSize: 12_345_678,
            mimeType: 'video/quicktime',
            // expo-image-picker uses `type: 'video'` alongside mimeType.
            type: 'video',
        } as any);

        expect(mocks.manipulateAsync).not.toHaveBeenCalled();
        expect(normalized).toEqual({
            uri: 'file:///tmp/PL_0001.MOV',
            mimeType: 'video/quicktime',
            name: 'PL_0001.MOV',
            width: 1920,
            height: 1080,
            isVideo: true,
        });
    });
});
