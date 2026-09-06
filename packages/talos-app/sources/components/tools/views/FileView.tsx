/**
 * View for 'file' tool calls in the chat transcript. Renders:
 *  - `image/*`: inline picture with thumbhash placeholder (existing behaviour)
 *  - `video/*`: compact file chip with a video icon (v1 does not embed a
 *    playable video — the CLI-side attachmentRouter already writes videos to
 *    a temp file and routes them via `@<path>` so Claude can act on them)
 *  - `application/pdf` + everything else: compact file chip with mime-typed
 *    icon
 *
 * The wire event now carries a required `mimeType` field. Older events that
 * pre-date the migration only carry `image?` — we fall back to that if the
 * MIME isn't present.
 */
import * as React from 'react';
import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ToolViewProps } from './_all';
import { z } from 'zod';
import { useAttachmentImage } from '@/hooks/useAttachmentImage';
import { thumbhashToDataUri } from '@/utils/thumbhash';

const fileInputSchema = z.object({
    ref: z.string(),
    name: z.string(),
    size: z.number().optional(),
    mimeType: z.string().optional(),
    image: z.object({
        width: z.number(),
        height: z.number(),
        thumbhash: z.string().optional(),
    }).optional(),
    video: z.object({
        width: z.number(),
        height: z.number(),
        durationMs: z.number().optional(),
        thumbhash: z.string().optional(),
    }).optional(),
});

const BORDER_RADIUS = 8;
const MAX_IMAGE_WIDTH = 280;
const MAX_IMAGE_HEIGHT = 360;
const DEFAULT_ASPECT = 4 / 3;

function iconNameForMime(mimeType: string): keyof typeof Ionicons.glyphMap {
    if (mimeType.startsWith('video/')) return 'videocam-outline';
    if (mimeType.startsWith('audio/')) return 'musical-notes-outline';
    if (mimeType === 'application/pdf') return 'document-text-outline';
    if (mimeType.startsWith('text/') || mimeType.startsWith('application/json') || mimeType.startsWith('application/xml')) {
        return 'code-slash-outline';
    }
    if (mimeType.startsWith('image/')) return 'image-outline';
    return 'document-outline';
}

function formatSize(bytes: number | undefined): string {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const FileView = React.memo<ToolViewProps>(({ tool, sessionId }) => {
    const { theme } = useUnistyles();
    const parsed = fileInputSchema.safeParse(tool.input);
    if (!parsed.success) return null;

    const { name, image, ref, mimeType, size } = parsed.data;
    // Back-compat: pre-migration file events had no mimeType field — infer
    // from the presence of `image` so old records keep rendering as images.
    const effectiveMime = mimeType ?? (image ? 'image/jpeg' : 'application/octet-stream');
    const isImage = effectiveMime.startsWith('image/');

    if (isImage) {
        return (
            <InlineImage
                name={name}
                image={image}
                ref_={ref}
                sessionId={sessionId}
                theme={theme}
            />
        );
    }

    return (
        <FileChip
            name={name}
            mimeType={effectiveMime}
            size={size}
            theme={theme}
        />
    );
});

function InlineImage({
    name,
    image,
    ref_,
    sessionId,
    theme,
}: {
    name: string;
    image?: { width: number; height: number; thumbhash?: string };
    ref_: string;
    sessionId?: string;
    theme: any;
}) {
    const placeholder = React.useMemo(() => {
        if (!image?.thumbhash) return undefined;
        const uri = thumbhashToDataUri(image.thumbhash);
        return uri ? { uri } : undefined;
    }, [image?.thumbhash]);

    const { uri, error } = useAttachmentImage(sessionId ?? '', sessionId ? ref_ : undefined);

    const aspect = image && image.width > 0 && image.height > 0
        ? image.width / image.height
        : DEFAULT_ASPECT;
    let displayW = Math.min(image?.width && image.width > 0 ? image.width : MAX_IMAGE_WIDTH, MAX_IMAGE_WIDTH);
    let displayH = displayW / aspect;
    if (displayH > MAX_IMAGE_HEIGHT) {
        displayH = MAX_IMAGE_HEIGHT;
        displayW = displayH * aspect;
    }

    return (
        <View style={styles.inlineContainer}>
            <View style={[styles.inlineWrapper, { borderColor: theme.colors.divider }]}>
                <Image
                    source={uri ? { uri } : undefined}
                    placeholder={placeholder}
                    style={[{ width: displayW, height: displayH }, styles.inlineImage]}
                    contentFit="cover"
                    transition={150}
                />
                {error && !uri && (
                    <View style={[styles.errorOverlay, { backgroundColor: theme.colors.surfaceHigh }]}>
                        <Ionicons name="alert-circle-outline" size={20} color={theme.colors.textSecondary} />
                    </View>
                )}
            </View>
            <Text style={[styles.filename, { color: theme.colors.textSecondary }]} numberOfLines={1}>{name}</Text>
        </View>
    );
}

function FileChip({
    name,
    mimeType,
    size,
    theme,
}: {
    name: string;
    mimeType: string;
    size?: number;
    theme: any;
}) {
    const sizeLabel = formatSize(size);
    return (
        <View style={styles.inlineContainer}>
            <View style={[styles.chip, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}>
                <Ionicons name={iconNameForMime(mimeType)} size={22} color={theme.colors.button.secondary.tint} />
                <View style={styles.chipTextGroup}>
                    <Text style={[styles.chipName, { color: theme.colors.text }]} numberOfLines={2}>{name}</Text>
                    {sizeLabel.length > 0 && (
                        <Text style={[styles.chipMeta, { color: theme.colors.textSecondary }]} numberOfLines={1}>{sizeLabel}</Text>
                    )}
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    inlineContainer: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 4,
    },
    inlineWrapper: {
        borderRadius: BORDER_RADIUS,
        borderWidth: 1,
        overflow: 'hidden',
        alignSelf: 'flex-start',
        position: 'relative',
    },
    inlineImage: {
        borderRadius: BORDER_RADIUS,
    },
    errorOverlay: {
        position: 'absolute',
        top: 4,
        right: 4,
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    filename: {
        fontSize: 13,
        fontWeight: '500',
    },
    chip: {
        alignSelf: 'flex-start',
        maxWidth: 280,
        borderRadius: BORDER_RADIUS,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    chipTextGroup: {
        flexShrink: 1,
    },
    chipName: {
        fontSize: 13,
        fontWeight: '500',
    },
    chipMeta: {
        fontSize: 11,
        marginTop: 2,
    },
}));
