import React from 'react';
import { View, Text, TextInput, ScrollView, Pressable, Platform, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from 'react-native';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { GlassView } from 'expo-glass-effect';
import { useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { resolveAbsolutePath } from '@/utils/pathUtils';

export type PickerItem = { key: string; label: string; subtitle?: string; dimmed?: boolean };

function trimTrailingPathSeparator(path: string): string {
    if (path === '/' || /^[A-Za-z]:[\\/]?$/.test(path)) {
        return path;
    }
    return path.replace(/[\\/]+$/, '');
}

function normalizePathForComparison(path: string | null | undefined, homeDir?: string): string | null {
    const trimmed = path?.trim() ?? '';
    if (!trimmed) {
        return null;
    }
    return trimTrailingPathSeparator(resolveAbsolutePath(trimmed, homeDir));
}

// Generic picker content — reused for machine, path, and worktree selection
export function PickerContent({
    title,
    fixedItems,
    items,
    selectedKey,
    onSelect,
    searchPlaceholder,
    embedded = false,
}: {
    title: string;
    fixedItems?: PickerItem[];
    items: PickerItem[];
    selectedKey: string | null;
    onSelect: (key: string) => void;
    searchPlaceholder?: string;
    embedded?: boolean;
}) {
    const { theme } = useUnistyles();
    const [search, setSearch] = React.useState('');
    const shouldShowSearch = !embedded || items.length + (fixedItems?.length ?? 0) > 4;

    const filtered = React.useMemo(() => {
        if (!shouldShowSearch || !search) return items;
        const q = search.toLowerCase();
        return items.filter(item => item.label.toLowerCase().includes(q));
    }, [shouldShowSearch, search, items]);

    const renderOption = (item: PickerItem) => {
        const isSelected = item.key === selectedKey;
        return (
            <Pressable
                key={item.key}
                accessibilityRole="radio"
                accessibilityLabel={item.label}
                accessibilityState={{ checked: isSelected }}
                aria-checked={isSelected}
                style={(p) => [
                    pickerStyles.option,
                    embedded && pickerStyles.embeddedOption,
                    p.pressed && pickerStyles.optionPressed,
                    item.dimmed && { opacity: 0.45 },
                ]}
                onPress={() => onSelect(item.key)}
            >
                <Octicons
                    name={isSelected ? 'check-circle-fill' : 'circle'}
                    size={16}
                    color={isSelected ? theme.colors.button.primary.background : theme.colors.textSecondary}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[pickerStyles.optionText, { color: theme.colors.text }]} numberOfLines={1}>
                        {item.label}
                    </Text>
                    {!!item.subtitle && (
                        <Text style={[pickerStyles.optionText, { color: theme.colors.textSecondary, fontSize: 13 }]} numberOfLines={1}>
                            {item.subtitle}
                        </Text>
                    )}
                </View>
            </Pressable>
        );
    };

    return (
        <View style={[pickerStyles.container, embedded && pickerStyles.embeddedContainer]}>
            {!embedded && (
                <Text style={[pickerStyles.title, { color: theme.colors.text }]}>{title}</Text>
            )}

            {shouldShowSearch && (
                <View style={[
                    pickerStyles.searchRow,
                    { backgroundColor: embedded ? 'transparent' : theme.colors.input.background },
                    embedded && pickerStyles.embeddedSearchRow,
                ]}>
                    <Ionicons name="search" size={16} color={theme.colors.textSecondary} />
                    <TextInput
                        accessibilityLabel={searchPlaceholder ?? `Search ${title.toLowerCase()}`}
                        value={search}
                        onChangeText={setSearch}
                        placeholder={searchPlaceholder ?? 'search...'}
                        placeholderTextColor={theme.colors.textSecondary}
                        style={[pickerStyles.searchInput, { color: theme.colors.text }]}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                </View>
            )}

            <ScrollView
                style={[pickerStyles.optionList, embedded && pickerStyles.embeddedOptionList]}
                contentContainerStyle={embedded && pickerStyles.embeddedOptionListContent}
                keyboardShouldPersistTaps="handled"
            >
                {fixedItems?.map(renderOption)}
                {fixedItems && fixedItems.length > 0 && filtered.length > 0 && (
                    <View style={[pickerStyles.divider, { backgroundColor: theme.colors.divider }]} />
                )}
                {filtered.map(renderOption)}
                {filtered.length === 0 && search.length > 0 && (
                    <Text style={[pickerStyles.emptyText, { color: theme.colors.textSecondary }]}>
                        no results
                    </Text>
                )}
            </ScrollView>
        </View>
    );
}

export function PathPickerContent({
    title,
    items,
    value,
    homeDir,
    onChangeValue,
    onDone,
    embedded = false,
}: {
    title: string;
    items: PickerItem[];
    value: string | null;
    homeDir?: string;
    onChangeValue: (value: string) => void;
    onDone?: () => void;
    embedded?: boolean;
}) {
    const { theme } = useUnistyles();
    const inputRef = React.useRef<TextInput>(null);
    const currentValue = value ?? '';
    const [selection, setSelection] = React.useState<{ start: number; end: number } | undefined>(undefined);

    React.useEffect(() => {
        const timeout = setTimeout(() => {
            inputRef.current?.focus();
        }, 50);
        return () => clearTimeout(timeout);
    }, []);

    const matchedItemKey = React.useMemo(() => {
        const normalizedValue = normalizePathForComparison(currentValue, homeDir);
        if (!normalizedValue) {
            return null;
        }

        const match = items.find((item) =>
            normalizePathForComparison(item.key, homeDir) === normalizedValue,
        );

        return match?.key ?? null;
    }, [currentValue, homeDir, items]);

    const handleSuggestionPress = React.useCallback((item: PickerItem) => {
        const nextValue = item.label;
        const nextSelection = { start: nextValue.length, end: nextValue.length };

        onChangeValue(nextValue);
        setSelection(nextSelection);

        setTimeout(() => {
            inputRef.current?.focus();
        }, 0);
    }, [onChangeValue]);

    const isCustomPath = currentValue.trim().length > 0 && matchedItemKey === null;
    const handleSelectionChange = React.useCallback((event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
        setSelection(event.nativeEvent.selection);
    }, []);
    const doneIconColor = theme.colors.header.tint;

    return (
        <View style={[pickerStyles.container, embedded && pickerStyles.embeddedContainer]}>
            {!embedded && (
                <View style={pickerStyles.titleRow}>
                    <Text style={[pickerStyles.title, { color: theme.colors.text }]}>{title}</Text>
                    {Platform.OS !== 'web' && onDone && (
                        <Pressable
                            onPress={onDone}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={({ pressed }) => [
                                pickerStyles.doneButtonPressable,
                                { opacity: pressed ? 0.82 : 1 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="Done"
                        >
                            <GlassView
                                glassEffectStyle="regular"
                                tintColor="rgba(255,255,255,0.10)"
                                isInteractive={true}
                                style={[
                                    pickerStyles.doneButtonGlass,
                                    { borderColor: 'rgba(255,255,255,0.16)' },
                                ]}
                            >
                                <Ionicons
                                    name="checkmark"
                                    size={20}
                                    color={doneIconColor}
                                />
                            </GlassView>
                        </Pressable>
                    )}
                </View>
            )}

            <View
                style={[
                    pickerStyles.pathInputRow,
                    {
                        backgroundColor: embedded ? 'transparent' : theme.colors.input.background,
                        borderColor: embedded ? 'transparent' : theme.colors.divider,
                    },
                    embedded && pickerStyles.embeddedPathInputRow,
                ]}
            >
                <Ionicons name="folder-outline" size={16} color={theme.colors.textSecondary} />
                <View style={pickerStyles.pathInputField}>
                    <TextInput
                        ref={inputRef}
                        accessibilityLabel="Project directory"
                        value={currentValue}
                        onChangeText={onChangeValue}
                        onSelectionChange={handleSelectionChange}
                        selection={selection}
                        placeholder="Enter project path"
                        placeholderTextColor={theme.colors.textSecondary}
                        style={[
                            pickerStyles.pathTextInput,
                            embedded && pickerStyles.embeddedPathTextInput,
                            { color: theme.colors.text },
                        ]}
                        autoCapitalize="none"
                        autoCorrect={false}
                        multiline={false}
                        numberOfLines={1}
                        returnKeyType="done"
                        onSubmitEditing={onDone}
                    />
                </View>
            </View>

            {isCustomPath && (
                <Text style={[pickerStyles.pathMetaText, { color: theme.colors.textSecondary }]}>
                    using custom path above
                </Text>
            )}

            <Text style={[pickerStyles.sectionLabel, { color: theme.colors.textSecondary }]}>
                Recent
            </Text>

            <ScrollView
                style={[pickerStyles.optionList, embedded && pickerStyles.embeddedOptionList]}
                contentContainerStyle={embedded && pickerStyles.embeddedOptionListContent}
                keyboardShouldPersistTaps="handled"
            >
                {items.map((item) => {
                    const isSelected = item.key === matchedItemKey;

                    return (
                        <Pressable
                            key={item.key}
                            accessibilityRole="radio"
                            accessibilityLabel={item.label}
                            accessibilityState={{ checked: isSelected }}
                            aria-checked={isSelected}
                            style={(p) => [
                                pickerStyles.option,
                                embedded && pickerStyles.embeddedOption,
                                p.pressed && pickerStyles.optionPressed,
                            ]}
                            onPress={() => handleSuggestionPress(item)}
                        >
                            <Ionicons
                                name="folder-outline"
                                size={16}
                                color={theme.colors.textSecondary}
                            />
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text style={[pickerStyles.optionText, { color: theme.colors.text }]} numberOfLines={1}>
                                    {item.label}
                                </Text>
                            </View>
                            {isSelected && (
                                <Ionicons
                                    name="checkmark-circle"
                                    size={18}
                                    color={theme.colors.button.primary.background}
                                />
                            )}
                        </Pressable>
                    );
                })}

                {items.length === 0 && (
                    <Text style={[pickerStyles.emptyText, { color: theme.colors.textSecondary }]}>
                        no recent projects yet
                    </Text>
                )}
            </ScrollView>
        </View>
    );
}

// Picker styles
const pickerStyles = {
    container: {
        flexShrink: 1,
        minHeight: 0,
        paddingHorizontal: 16,
        paddingBottom: 8,
    } as const,
    embeddedContainer: {
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        alignSelf: 'stretch',
        paddingHorizontal: 0,
        paddingBottom: 2,
    } as const,
    title: {
        fontSize: 18,
        paddingVertical: 12,
        paddingHorizontal: 4,
        ...Typography.default('semiBold'),
        ...Platform.select({ web: { userSelect: 'none' } as any, default: {} }),
    } as const,
    titleRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        justifyContent: 'space-between' as const,
    },
    doneButtonPressable: {
        width: 44,
        height: 44,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    },
    doneButtonGlass: {
        width: 40,
        height: 36,
        borderRadius: 18,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        overflow: 'hidden' as const,
        borderWidth: 1,
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    searchRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        marginBottom: 8,
    },
    embeddedSearchRow: {
        width: '100%',
        minWidth: 0,
        paddingHorizontal: 4,
        paddingVertical: 8,
        borderRadius: 0,
        marginBottom: 4,
    } as const,
    searchInput: {
        flex: 1,
        minWidth: 0,
        fontSize: 15,
        padding: 0,
        ...Typography.default(),
        ...Platform.select({ web: { outlineStyle: 'none' } as any, default: {} }),
    } as const,
    pathInputRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 10,
        paddingHorizontal: 12,
        minHeight: 46,
        borderRadius: 12,
        marginBottom: 8,
        borderWidth: 1,
    },
    embeddedPathInputRow: {
        width: '100%',
        minWidth: 0,
        paddingHorizontal: 4,
        minHeight: 38,
        borderRadius: 0,
        borderWidth: 0,
        marginBottom: 4,
    } as const,
    pathInputField: {
        flex: 1,
        minWidth: 0,
    } as const,
    pathTextInput: {
        fontSize: 16,
        minHeight: 44,
        paddingVertical: 0,
        ...Typography.default(),
        ...Platform.select({
            android: { textAlignVertical: 'center' as const },
            web: { outlineStyle: 'none' } as any,
            default: {},
        }),
    } as const,
    embeddedPathTextInput: {
        fontSize: 15,
        minHeight: 34,
    } as const,
    pathMetaText: {
        fontSize: 13,
        paddingHorizontal: 4,
        paddingBottom: 8,
        ...Typography.default(),
        ...Platform.select({ web: { userSelect: 'none' } as any, default: {} }),
    } as const,
    sectionLabel: {
        fontSize: 13,
        paddingHorizontal: 4,
        paddingBottom: 8,
        ...Typography.default('semiBold'),
        ...Platform.select({ web: { userSelect: 'none' } as any, default: {} }),
    } as const,
    option: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderRadius: 12,
    },
    embeddedOption: {
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        paddingHorizontal: 4,
        paddingVertical: 8,
        borderRadius: 0,
    } as const,
    optionPressed: {
        opacity: 0.6,
    } as const,
    optionText: {
        minWidth: 0,
        flexShrink: 1,
        fontSize: 15,
        ...Typography.default(),
        ...Platform.select({ web: { userSelect: 'none' } as any, default: {} }),
    } as const,
    divider: {
        height: 1,
        marginHorizontal: 12,
        marginVertical: 4,
    } as const,
    optionList: {
        flexGrow: 0,
        flexShrink: 1,
    } as const,
    embeddedOptionList: {
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        maxHeight: 176,
    } as const,
    embeddedOptionListContent: {
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
    } as const,
    emptyText: {
        fontSize: 14,
        textAlign: 'center' as const,
        paddingVertical: 20,
        ...Typography.default(),
        ...Platform.select({ web: { userSelect: 'none' } as any, default: {} }),
    } as const,
};
