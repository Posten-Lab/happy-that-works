import * as React from 'react';
import { Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { getRandomBytesAsync } from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/auth/AuthContext';
import { authGetToken } from '@/auth/authGetToken';
import { encodeBase64 } from '@/encryption/base64';
import { RoundButton } from '@/components/RoundButton';
import { HomeHeaderNotAuth } from '@/components/HomeHeader';
import { MainView } from '@/components/MainView';
import { TalosBrand, TalosMark } from '@/components/TalosBrand';
import { Typography } from '@/constants/Typography';
import { trackAccountCreated, trackAccountRestored } from '@/track';
import { Modal } from '@/modal';
import { t } from '@/text';

export default function Home() {
    const auth = useAuth();
    return auth.isAuthenticated ? <MainView variant="phone" /> : <Welcome />;
}

function Welcome() {
    const auth = useAuth();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const wide = width >= 860;
    const native = Platform.OS === 'ios' || Platform.OS === 'android';

    const createAccount = async () => {
        try {
            const secret = await getRandomBytesAsync(32);
            const token = await authGetToken(secret);
            await auth.login(token, encodeBase64(secret, 'base64url'));
            trackAccountCreated();
        } catch (error) {
            console.error('Talos account creation failed:', error instanceof Error ? error.message : 'Unknown error');
            Modal.alert(t('common.error'), t('errors.authenticationFailed'));
        }
    };
    const restore = () => {
        trackAccountRestored();
        router.push('/restore');
    };

    return (
        <>
            <HomeHeaderNotAuth />
            <ScrollView contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + 24 }]}>
                <View style={[styles.card, wide && styles.wideCard]}>
                    <View style={[styles.artPanel, wide && styles.wideArtPanel]}>
                        <View style={styles.emblem}>
                            <TalosMark size={wide ? 224 : 136} />
                        </View>
                        <Text style={styles.artWordmark}>TALOS</Text>
                        <View style={styles.rule} />
                        <View style={styles.privacy}>
                            <Ionicons name="lock-closed-outline" size={15} color="#D9AE68" />
                            <Text style={styles.privacyText}>{t('welcome.subtitle')}</Text>
                        </View>
                    </View>
                    <View style={[styles.content, wide && styles.wideContent]}>
                        {wide && <TalosBrand size={28} />}
                        <Text accessibilityRole="header" style={[styles.title, wide && styles.wideTitle]}>
                            {t('welcome.title')}
                        </Text>
                        <View style={styles.actions}>
                            <RoundButton
                                title={native ? t('welcome.createAccount') : t('welcome.loginWithMobileApp')}
                                action={native ? createAccount : undefined}
                                onPress={native ? undefined : restore}
                            />
                            <RoundButton
                                title={native ? t('welcome.linkOrRestoreAccount') : t('welcome.createAccount')}
                                action={native ? undefined : createAccount}
                                onPress={native ? restore : undefined}
                                display="inverted"
                            />
                        </View>
                    </View>
                </View>
            </ScrollView>
        </>
    );
}

const styles = StyleSheet.create((theme) => ({
    page: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: theme.colors.groupped.background },
    card: { width: '100%', maxWidth: 480, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface },
    wideCard: { maxWidth: 1060, minHeight: 540, flexDirection: 'row' },
    artPanel: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#191916', paddingHorizontal: 28, paddingVertical: 32 },
    wideArtPanel: { width: '45%', paddingVertical: 56 },
    emblem: { alignItems: 'center', justifyContent: 'center' },
    artWordmark: { ...Typography.default('semiBold'), fontSize: 30, letterSpacing: 10, color: '#F2EEE5', marginLeft: 10, marginTop: 20 },
    rule: { width: 36, height: 1, backgroundColor: '#A37D43', marginTop: 20, marginBottom: 16 },
    privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, maxWidth: 280 },
    privacyText: { ...Typography.default(), flexShrink: 1, fontSize: 13, lineHeight: 19, color: '#BDB4A4', textAlign: 'center' },
    content: { padding: 28, justifyContent: 'center' },
    wideContent: { flex: 1, padding: 56 },
    title: { ...Typography.default('semiBold'), fontSize: 30, lineHeight: 38, letterSpacing: -0.6, color: theme.colors.text, marginBottom: 28 },
    wideTitle: { fontSize: 44, lineHeight: 52, letterSpacing: -1.2, marginTop: 36, marginBottom: 36 },
    actions: { gap: 12 },
}));
