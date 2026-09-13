import React from 'react';
import { Text, TextInput, Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
export function useWorkflowStyles() {
    const { theme } = useUnistyles(); const c = theme.colors;
    return { row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as const, colors: c, text: { color: c.text, fontSize: 16, lineHeight: 24 }, muted: { color: c.textSecondary, fontSize: 14, lineHeight: 21 },
        card: { backgroundColor: c.surface, borderColor: c.divider, borderWidth: 1, borderRadius: 16, padding: 18, gap: 12 } as const };
}
export function WorkflowButton({ label, onPress, primary = false, disabled = false, selected, accessibilityLabel }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; selected?: boolean; accessibilityLabel?: string }) {
    const { colors: c } = useWorkflowStyles();
    return <Pressable accessibilityRole={selected === undefined ? 'button' : 'checkbox'} accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled, ...(selected === undefined ? {} : { checked: selected }) }} disabled={disabled} onPress={onPress}
        style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10, borderWidth: 1,
            borderColor: primary || selected ? c.accent : c.divider, backgroundColor: pressed ? c.divider : c.surface, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 })}>
        <Text style={{ color: primary || selected ? c.accent : c.text, fontSize: 15, fontWeight: '600' }}>{selected !== undefined ? `${selected ? '✓' : '○'}  ` : ''}{label}</Text>
    </Pressable>;
}
export function WorkflowInput({ label, value, onChange, multiline = false, max = 24000 }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; max?: number }) {
    const { text, colors: c } = useWorkflowStyles();
    return <View style={{ gap: 6 }}><Text style={text}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} multiline={multiline} maxLength={max} style={{ ...text, borderWidth: 1, borderColor: c.divider, borderRadius: 10, padding: 12, minHeight: multiline ? 100 : 48, textAlignVertical: 'top' }} /></View>;
}
