import * as React from 'react';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

const styles = StyleSheet.create((theme) => ({
    lockup: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    wordmark: { ...Typography.default('semiBold'), color: theme.colors.text, letterSpacing: 4 },
}));

/** The supplied artwork remains a single image; the wordmark scales as native text. */
export const TalosMark = React.memo(({ size = 32 }: { size?: number }) => {
    const { theme } = useUnistyles();
    return <Image
        source={size <= 64 ? require('@/assets/images/logo-white.png') : require('@/assets/images/talos-mark.png')}
        tintColor={size <= 64 ? theme.colors.accent : undefined}
        contentFit="contain"
        style={{ width: size, height: size }}
        accessibilityLabel="Talos"
    />;
});

export const TalosBrand = React.memo(({ size = 36 }: { size?: number }) => (
    <View style={styles.lockup} accessibilityLabel="Talos" accessible>
        <TalosMark size={size} />
        <Text style={[styles.wordmark, { fontSize: size * 0.6 }]}>TALOS</Text>
    </View>
));
