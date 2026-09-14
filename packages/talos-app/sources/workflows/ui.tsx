import React from 'react';
import { Text, TextInput, Pressable, View, ScrollView, Keyboard, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { BaseModal } from '@/modal/components/BaseModal';
import { useUnistyles } from 'react-native-unistyles';
export function useWorkflowStyles() {
    const { theme } = useUnistyles(); const c = theme.colors;
    return { row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as const, colors: c, text: { ...Typography.default(), color: c.text, fontSize: 16, lineHeight: 24 }, muted: { ...Typography.default(), color: c.textSecondary, fontSize: 14, lineHeight: 21 },
        card: { backgroundColor: c.surface, borderColor: c.divider, borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 } as const };
}
export function WorkflowButton({ label, onPress, primary = false, disabled = false, selected, accessibilityLabel }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; selected?: boolean; accessibilityLabel?: string }) {
    const { colors: c } = useWorkflowStyles();
    return <Pressable accessibilityRole={selected === undefined ? 'button' : 'checkbox'} accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled, ...(selected === undefined ? {} : { checked: selected }) }} disabled={disabled} onPress={onPress}
        style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10, borderWidth: 1,
            borderColor: primary || selected ? c.accent : c.divider, backgroundColor: primary ? c.button.primary.background : pressed ? c.divider : c.surface, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 })}>
        <Text style={{ ...Typography.default('semiBold'), color: primary ? c.button.primary.tint : selected ? c.accent : c.text, fontSize: 15, fontWeight: '600' }}>{selected !== undefined ? `${selected ? '✓' : '○'}  ` : ''}{label}</Text>
    </Pressable>;
}
export function WorkflowInput({ label, value, onChange, multiline = false, max = 24000 }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; max?: number }) {
    const { text, colors: c } = useWorkflowStyles();
    return <View style={{ gap: 6 }}><Text style={{ ...text, fontSize: 13, color: c.textSecondary }}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} multiline={multiline} maxLength={max} style={{ ...text, borderWidth: 1, borderColor: c.divider, borderRadius: 10, padding: 12, minHeight: multiline ? 100 : 48, textAlignVertical: 'top' }} /></View>;
}

export type WorkflowSelection = { title: string; options: { value: string; label: string; description?: string }[]; value: string; onSelect: (value: string) => void };
export const WorkflowPickerContext = React.createContext<((selection: WorkflowSelection) => void) | null>(null);
export function WorkflowSelectionList({ selection, onClose }: { selection: WorkflowSelection; onClose: () => void }) {
    const s = useWorkflowStyles();
    return <View style={{ flex: 1, minHeight: 0 }}>
        <View style={{ padding: 16, borderBottomWidth: 1, borderColor: s.colors.divider, gap: 12 }}>
            <WorkflowButton label="Back" accessibilityLabel={`Back from ${selection.title}`} onPress={onClose} />
            <Text accessibilityRole="header" style={{ ...s.text, ...Typography.header(), fontSize: 22 }}>{selection.title}</Text>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16 }}>
            {selection.options.map(option => <Pressable key={option.value} accessibilityRole="radio" aria-checked={selection.value === option.value} accessibilityState={{ checked: selection.value === option.value }}
                accessibilityLabel={option.label} onPress={() => { selection.onSelect(option.value); onClose(); }}
                style={({ pressed }) => ({ minHeight: 56, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: pressed ? s.colors.divider : 'transparent' })}>
                <View style={{ flex: 1 }}><Text style={s.text}>{option.label}</Text>{option.description && <Text style={s.muted}>{option.description}</Text>}</View>
                {selection.value === option.value && <Ionicons name="checkmark" size={22} color={s.colors.accent} />}
            </Pressable>)}
        </ScrollView>
    </View>;
}
export function WorkflowSelect({ label, value, options, selected, onSelect, disabled = false }: { label: string; value: string; options: WorkflowSelection['options']; selected: string; onSelect: (value: string) => void; disabled?: boolean }) {
    const s = useWorkflowStyles(), present = React.useContext(WorkflowPickerContext), window = useWindowDimensions();
    const [selection, setSelection] = React.useState<WorkflowSelection | null>(null);
    return <>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} accessibilityState={{ disabled }} disabled={disabled}
            onPress={() => { Keyboard.dismiss(); (present ?? setSelection)({ title: `Choose ${label.toLowerCase()}`, options, value: selected, onSelect }); }}
            style={({ pressed }) => ({ minHeight: 62, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: s.colors.divider, opacity: disabled ? 0.5 : 1, backgroundColor: pressed ? s.colors.divider : 'transparent' })}>
            <View style={{ flex: 1, gap: 2 }}><Text style={{ ...s.muted, fontSize: 12 }}>{label}</Text><Text style={{ ...s.text, ...Typography.header() }}>{value}</Text></View>
            {!disabled && <Ionicons name="chevron-forward" size={18} color={s.colors.textSecondary} />}
        </Pressable>
        {!present && selection && <BaseModal visible onClose={() => setSelection(null)}><View style={{ width: Math.min(window.width - 24, 520), height: Math.min(window.height - 100, 540), borderRadius: 20, backgroundColor: s.colors.surface, overflow: 'hidden' }}><WorkflowSelectionList selection={selection} onClose={() => setSelection(null)} /></View></BaseModal>}
    </>;
}
