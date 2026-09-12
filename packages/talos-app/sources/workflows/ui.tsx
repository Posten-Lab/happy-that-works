import React from 'react';
import { Text, TextInput, Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
export function useWorkflowStyles() {
    const { theme } = useUnistyles(); const c = theme.colors;
    return { colors: c, text: { color: c.text, fontSize: 16, lineHeight: 24 }, muted: { color: c.textSecondary, fontSize: 14, lineHeight: 21 },
        card: { backgroundColor: c.surface, borderColor: c.divider, borderWidth: 1, borderRadius: 16, padding: 18, gap: 12 } as const };
}
export function WorkflowButton({ label, onPress, primary = false, disabled = false }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
    const { colors: c } = useWorkflowStyles();
    return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={{ padding: 12, borderRadius: 10, borderWidth: 1, borderColor: primary ? c.accent : c.divider, backgroundColor: primary ? c.accent : c.surface, opacity: disabled ? 0.45 : 1 }}><Text style={{ color: primary ? c.button.primary.tint : c.text, fontSize: 15, fontWeight: '600' }}>{label}</Text></Pressable>;
}
export function WorkflowInput({ label, value, onChange, multiline = false, max = 24000 }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; max?: number }) {
    const { text, colors: c } = useWorkflowStyles();
    return <View style={{ gap: 6 }}><Text style={text}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} multiline={multiline} maxLength={max} style={{ ...text, borderWidth: 1, borderColor: c.divider, borderRadius: 10, padding: 12, minHeight: multiline ? 100 : 48, textAlignVertical: 'top' }} /></View>;
}
