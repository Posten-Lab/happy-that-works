import * as React from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { t } from '@/text';
import { decodeBase64 } from '@/encryption/base64';
import { openAttachment } from '@/utils/openAttachment';

export function AttachmentImageViewer({ name, uri, loading, error, onRetry, onClose }: {
    name: string;
    uri: string | null;
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    onClose: () => void;
}) {
    const insets = useSafeAreaInsets();
    const [zoom, setZoom] = React.useState(1);
    const [saving, setSaving] = React.useState(false);
    const [saveError, setSaveError] = React.useState(false);
    const [imageError, setImageError] = React.useState(false);
    const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
    const [dimensions, setDimensions] = React.useState({ width: 1, height: 1 });
    const savingRef = React.useRef(false);
    React.useEffect(() => { setImageError(false); }, [uri]);
    const failed = error || imageError;
    const scale = Math.min(viewport.width / dimensions.width, viewport.height / dimensions.height);

    async function save() {
        if (!uri || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setSaveError(false);
        try {
            const mimeType = uri.slice(5, uri.indexOf(';'));
            await openAttachment(name, mimeType, async () => decodeBase64(uri.slice(uri.indexOf(',') + 1)));
        } catch {
            setSaveError(true);
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }

    return (
        <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
            <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
                <View style={styles.toolbar}>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('attachments.closePreview')} onPress={onClose} style={styles.button}>
                        <Ionicons name="close" size={24} color="white" />
                    </Pressable>
                    <Text style={styles.title} numberOfLines={1}>{name}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={t(zoom === 1 ? 'attachments.zoomIn' : 'attachments.zoomOut')} disabled={!uri || !!failed} onPress={() => setZoom(zoom === 1 ? 2 : 1)} style={styles.button}>
                        <Ionicons name={zoom === 1 ? 'add' : 'remove'} size={24} color="white" />
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('attachments.openFile')} disabled={!uri || saving} onPress={save} style={styles.button}>
                        {saving ? <ActivityIndicator color="white" /> : <Ionicons name="share-outline" size={24} color="white" />}
                    </Pressable>
                </View>
                <View style={styles.body} onLayout={event => setViewport(event.nativeEvent.layout)}>
                    {loading ? <ActivityIndicator size="large" color="white" /> : failed ? (
                        <View style={styles.message}>
                            <Text style={styles.messageText}>{t('attachments.loadFailed')}</Text>
                            <Pressable accessibilityRole="button" onPress={() => { setImageError(false); onRetry(); }} style={styles.button}>
                                <Text style={styles.messageText}>{t('common.retry')}</Text>
                            </Pressable>
                        </View>
                    ) : uri ? (
                        <ScrollView key={zoom} style={{ flex: 1 }} contentContainerStyle={styles.scrollContent} maximumZoomScale={Platform.OS === 'ios' ? 4 : 1} minimumZoomScale={1} centerContent>
                            <ScrollView horizontal contentContainerStyle={styles.scrollContent}>
                                <Image source={{ uri }} accessibilityLabel={name} contentFit="contain"
                                    style={{ width: dimensions.width * scale * zoom, height: dimensions.height * scale * zoom }}
                                    onLoad={event => setDimensions({ width: event.source.width || 1, height: event.source.height || 1 })}
                                    onError={() => setImageError(true)} />
                            </ScrollView>
                        </ScrollView>
                    ) : null}
                </View>
                {saveError && <Text accessibilityRole="alert" style={styles.messageText}>{t('attachments.openFailed')}</Text>}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#111111' },
    toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
    button: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 8 },
    title: { color: 'white', flex: 1, fontSize: 16 },
    body: { flex: 1, justifyContent: 'center', alignItems: 'stretch' },
    scrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
    message: { alignItems: 'center', padding: 24 },
    messageText: { color: 'white', textAlign: 'center', padding: 8 },
});
