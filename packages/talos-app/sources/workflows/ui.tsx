import React from 'react';
import { Text, TextInput, Pressable, View, ScrollView, Keyboard, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { BaseModal } from '@/modal/components/BaseModal';
import { useUnistyles } from 'react-native-unistyles';
export function useWorkflowStyles() {
    const { theme } = useUnistyles(); const c = theme.colors;
    return { row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } as const, colors: c, text: { ...Typography.default(), color: c.text, fontSize: 16, lineHeight: 24 }, muted: { ...Typography.default(), color: c.textSecondary, fontSize: 14, lineHeight: 21 },
        card: { backgroundColor: c.surface, borderColor: c.divider, borderWidth: 1, borderRadius: 20, padding: 20, gap: 14 } as const };
}
export function WorkflowButton({ label, onPress, primary = false, disabled = false, selected, accessibilityLabel, variant = 'secondary', icon, compact = false }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; selected?: boolean; accessibilityLabel?: string; variant?: 'secondary' | 'ghost' | 'danger'; icon?: React.ComponentProps<typeof Ionicons>['name']; compact?: boolean }) {
    const { colors: c } = useWorkflowStyles();
    const ghost = variant === 'ghost';
    const tint = primary ? c.button.primary.tint : selected ? c.accent : variant === 'danger' ? c.textDestructive : c.text;
    return <Pressable accessibilityRole={selected === undefined ? 'button' : 'checkbox'} accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled, ...(selected === undefined ? {} : { checked: selected }) }} disabled={disabled} onPress={onPress}
        style={({ pressed }) => ({ minHeight: compact ? 44 : 48, paddingHorizontal: ghost ? 8 : 16, paddingVertical: 11, borderRadius: 12, borderWidth: ghost ? 0 : 1,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            borderColor: primary ? c.button.primary.background : selected ? c.accent : c.divider, backgroundColor: primary ? c.button.primary.background : pressed ? c.surfacePressed : ghost ? 'transparent' : selected ? c.accentSoft : c.surface, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 })}>
        {(icon || selected !== undefined) && <Ionicons name={icon ?? (selected ? 'checkbox' : 'square-outline')} size={18} color={tint} />}
        <Text style={{ ...Typography.default('semiBold'), color: tint, fontSize: 15, lineHeight: 21, textAlign: 'center', flexShrink: 1 }}>{label}</Text>
    </Pressable>;
}
export function WorkflowInput({ label, value, onChange, multiline = false, max = 24000, placeholder, hint, numeric = false, mono = false }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; max?: number; placeholder?: string; hint?: string; numeric?: boolean; mono?: boolean }) {
    const { text, colors: c } = useWorkflowStyles();
    const [focused, setFocused] = React.useState(false);
    return <View style={{ gap: 8 }}>
        <Text style={{ ...text, ...Typography.header(), fontSize: 14, lineHeight: 20 }}>{label}</Text>
        <TextInput accessibilityLabel={label} accessibilityHint={hint} value={value} onChangeText={onChange} multiline={multiline}
            maxLength={max} placeholder={placeholder} placeholderTextColor={c.textSecondary} keyboardType={numeric ? 'number-pad' : mono && Platform.OS === 'ios' ? 'ascii-capable' : 'default'}
            autoCorrect={mono ? false : undefined} autoCapitalize={mono ? 'none' : 'sentences'} smartInsertDelete={mono ? false : undefined}
            onFocus={e => { setFocused(true); if (Platform.OS === 'web') { const target = e.target as unknown as HTMLElement; setTimeout(() => target.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }), 150); } }}
            onBlur={() => setFocused(false)} style={{ ...text, ...(mono ? Typography.mono() : {}), fontSize: mono ? 14 : 16, backgroundColor: c.surface, borderWidth: 1, borderColor: focused ? c.accent : c.divider, borderRadius: 12, padding: 14, minHeight: multiline ? 116 : 52, maxHeight: multiline ? 220 : undefined, textAlignVertical: 'top' }} />
        {!!hint && <Text style={{ ...text, color: c.textSecondary, fontSize: 12, lineHeight: 18 }}>{hint}</Text>}
    </View>;
}

export function WorkflowAvatar({ name, provider, size = 36 }: { name: string; provider?: string; size?: number }) {
    const s = useWorkflowStyles();
    const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0] ?? '').join('').toUpperCase();
    return <View accessibilityLabel={provider ? `${name}, ${provider}` : name} style={{ width: size, height: size, borderRadius: Math.round(size * 0.32), backgroundColor: s.colors.accentSoft, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: s.colors.divider }}>
        <Text style={{ ...Typography.header(), color: s.colors.accent, fontSize: Math.round(size * 0.34), letterSpacing: -0.5 }}>{initials || 'A'}</Text>
    </View>;
}

export function WorkflowStatusChip({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'active' | 'warning' }) {
    const s = useWorkflowStyles();
    const tint = tone === 'success' ? s.colors.success : tone === 'active' ? s.colors.accent : tone === 'warning' ? s.colors.warning : s.colors.textSecondary;
    return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 9, borderRadius: 20, backgroundColor: tone === 'active' ? s.colors.accentSoft : s.colors.surfaceHigh }}>
        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: tint }} />
        <Text style={{ ...Typography.default('semiBold'), fontSize: 12, lineHeight: 18, color: tint }}>{label}</Text>
    </View>;
}

export function WorkflowSectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
    const s = useWorkflowStyles();
    return <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 36 }}>
        <Text accessibilityRole="header" style={{ ...s.text, ...Typography.header(), fontSize: 17, flex: 1 }}>{title}</Text>
        {action && onAction && <Pressable accessibilityRole="button" accessibilityLabel={action} onPress={onAction} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}><Text style={{ ...s.muted, ...Typography.header(), color: s.colors.accent }}>{action}</Text></Pressable>}
    </View>;
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
                <View style={{ flex: 1 }}><Text style={s.text}>{option.label}</Text>{!!option.description && <Text style={s.muted}>{option.description}</Text>}</View>
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
