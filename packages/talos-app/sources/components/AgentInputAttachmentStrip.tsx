/**
 * Horizontal scrollable strip showing selected attachment previews.
 *
 * Two chip variants, picked per attachment based on its MIME:
 *  - Image (default): 64×64 thumbnail with thumbhash placeholder while the
 *    full picture streams in.
 *  - File chip: filename + type icon for videos, PDFs, source files, and
 *    anything else. Renders when the picker marks the attachment `isFile`.
 *
 * When the CLI reports back via `t:'file-status'` and the corresponding
 * `AttachmentPreview.status` flips to 'rejected', both variants render with
 * a red border and the reason as a tooltip / small caption.
 */
import * as React from 'react';
import { ScrollView, View, Pressable, Text } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { AttachmentPreview, AttachmentRejectionReason } from '@/sync/attachmentTypes';
import { thumbhashToDataUri } from '@/utils/thumbhash';

const THUMB_SIZE = 64;
const CHIP_HEIGHT = 64;
const CHIP_MAX_WIDTH = 200;
const BORDER_RADIUS = 8;

interface AgentInputAttachmentStripProps {
    images: AttachmentPreview[];
    onRemove: (id: string) => void;
}

export function AgentInputAttachmentStrip({ images, onRemove }: AgentInputAttachmentStripProps) {
    const { theme } = useUnistyles();

    if (images.length === 0) return null;

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.strip}
            contentContainerStyle={styles.stripContent}
            keyboardShouldPersistTaps="always"
        >
            {images.map((att) => (
                att.isFile
                    ? <FileChip key={att.id} attachment={att} onRemove={onRemove} theme={theme} />
                    : <AttachmentThumbnail key={att.id} image={att} onRemove={onRemove} theme={theme} />
            ))}
        </ScrollView>
    );
}

function borderColorForStatus(theme: any, att: AttachmentPreview): string {
    if (att.status === 'rejected') return theme.colors.status?.error ?? '#e5484d';
    return theme.colors.divider;
}

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

function reasonToLabel(reason: AttachmentRejectionReason | undefined): string | undefined {
    if (!reason) return undefined;
    switch (reason) {
        case 'download_failed': return 'download failed';
        case 'decrypt_failed': return 'decrypt failed';
        case 'empty_bytes': return 'empty file';
        case 'image_too_large': return 'too large';
        case 'document_too_large': return 'too large';
        case 'tempfile_write_failed': return 'CLI write failed';
        case 'unsupported': return 'unsupported';
        default: return reason;
    }
}

function AttachmentThumbnail({
    image,
    onRemove,
    theme,
}: {
    image: AttachmentPreview;
    onRemove: (id: string) => void;
    theme: any;
}) {
    // Build placeholder from thumbhash if available
    const placeholder = React.useMemo(() => {
        if (!image.thumbhash) return undefined;
        const uri = thumbhashToDataUri(image.thumbhash);
        return uri ? { uri } : undefined;
    }, [image.thumbhash]);

    const isRejected = image.status === 'rejected';

    return (
        <View>
            <View style={[
                styles.thumbContainer,
                {
                    borderColor: borderColorForStatus(theme, image),
                    borderWidth: isRejected ? 2 : 1,
                }
            ]}>
                <Image
                    source={{ uri: image.uri }}
                    placeholder={placeholder}
                    style={[{ width: THUMB_SIZE, height: THUMB_SIZE }, styles.thumb]}
                    contentFit="cover"
                    transition={150}
                />
                <Pressable
                    onPress={() => onRemove(image.id)}
                    hitSlop={4}
                    style={(p) => [
                        styles.removeButton,
                        { backgroundColor: theme.colors.surfaceHigh, opacity: p.pressed ? 0.7 : 1 }
                    ]}
                >
                    <Ionicons name="close" size={10} color={theme.colors.text} />
                </Pressable>
            </View>
            {isRejected && (
                <Text
                    numberOfLines={1}
                    style={[styles.reasonLabel, { color: theme.colors.status?.error ?? '#e5484d' }]}
                >
                    {reasonToLabel(image.reason)}
                </Text>
            )}
        </View>
    );
}

function FileChip({
    attachment,
    onRemove,
    theme,
}: {
    attachment: AttachmentPreview;
    onRemove: (id: string) => void;
    theme: any;
}) {
    const isRejected = attachment.status === 'rejected';
    return (
        <View>
            <View style={[
                styles.chipContainer,
                {
                    borderColor: borderColorForStatus(theme, attachment),
                    borderWidth: isRejected ? 2 : 1,
                    backgroundColor: theme.colors.surfaceHigh,
                }
            ]}>
                <Ionicons name={iconNameForMime(attachment.mimeType)} size={20} color={theme.colors.button.secondary.tint} />
                <Text numberOfLines={2} style={[styles.chipName, { color: theme.colors.text }]}>
                    {attachment.name}
                </Text>
                <Pressable
                    onPress={() => onRemove(attachment.id)}
                    hitSlop={4}
                    style={(p) => [
                        styles.removeButton,
                        { backgroundColor: theme.colors.surfaceHigh, opacity: p.pressed ? 0.7 : 1 }
                    ]}
                >
                    <Ionicons name="close" size={10} color={theme.colors.text} />
                </Pressable>
            </View>
            {isRejected && (
                <Text
                    numberOfLines={1}
                    style={[styles.reasonLabel, { color: theme.colors.status?.error ?? '#e5484d' }]}
                >
                    {reasonToLabel(attachment.reason)}
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    strip: {
        marginBottom: 8,
        marginHorizontal: 8,
    },
    stripContent: {
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 4,
    },
    thumbContainer: {
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        borderRadius: BORDER_RADIUS,
        overflow: 'visible',
        borderWidth: 1,
        position: 'relative',
    },
    thumb: {
        borderRadius: BORDER_RADIUS,
    },
    chipContainer: {
        minWidth: 100,
        maxWidth: CHIP_MAX_WIDTH,
        height: CHIP_HEIGHT,
        borderRadius: BORDER_RADIUS,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        position: 'relative',
    },
    chipName: {
        fontSize: 12,
        flexShrink: 1,
    },
    removeButton: {
        position: 'absolute',
        top: -6,
        right: -6,
        width: 18,
        height: 18,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
    },
    reasonLabel: {
        fontSize: 10,
        marginTop: 2,
        maxWidth: CHIP_MAX_WIDTH,
    },
}));
