import * as React from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useGlobalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { sessionSearch } from '@/sync/search/sessionSearch';
import { t } from '@/text';
import { layout } from './layout';
import { highlightSearchText, searchExcerpt } from './sessionSearchPresentation';

type SearchResult = ReturnType<typeof sessionSearch.search>[number];
type SearchMatch = SearchResult['matches'][number];

export const SessionSearch = React.memo(({ children }: { children: React.ReactNode }) => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const inputRef = React.useRef<TextInput>(null);
    const [query, setQuery] = React.useState('');
    const [isOpen, setIsOpen] = React.useState(false);
    const [includeAgentReplies, setIncludeAgentReplies] = React.useState(false);
    const [openingSessionId, setOpeningSessionId] = React.useState<string | null>(null);
    const [openError, setOpenError] = React.useState(false);
    const [expandedResults, setExpandedResults] = React.useState<Set<string>>(() => new Set());
    const { sessionSearch: searchRequest } = useGlobalSearchParams<{ sessionSearch?: string }>();
    const deferredQuery = React.useDeferredValue(query.trim());
    const snapshot = React.useSyncExternalStore(sessionSearch.subscribe, sessionSearch.getSnapshot, sessionSearch.getSnapshot);
    const results = React.useMemo(
        () => sessionSearch.search(deferredQuery, { includeAgentReplies }),
        [deferredQuery, includeAgentReplies, snapshot.revision],
    );
    const mounted = React.useRef(true);
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const closeSearch = React.useCallback(() => {
        setQuery('');
        setIsOpen(false);
        inputRef.current?.blur();
        if (searchRequest) router.setParams({ sessionSearch: undefined });
    }, [router, searchRequest]);

    React.useEffect(() => {
        if (!isOpen) return;
        void sessionSearch.start().catch(() => { /* The service publishes the retryable error. */ });
    }, [isOpen]);

    React.useEffect(() => {
        if (Platform.OS !== 'web') return;
        const listener = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && inputRef.current?.isFocused()) {
                closeSearch();
            }
        };
        document.addEventListener('keydown', listener);
        return () => document.removeEventListener('keydown', listener);
    }, [closeSearch]);

    React.useEffect(() => {
        if (!searchRequest) return;
        setIsOpen(true);
        let attempts = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const focusWhenVisible = () => {
            const node = inputRef.current as unknown as HTMLElement | null;
            const rect = Platform.OS === 'web' ? node?.getBoundingClientRect() : undefined;
            // A previous stack screen can stay mounted behind the conversation.
            // Wait for navigation to reveal this field before focusing it.
            const visible = !rect || (rect.width > 0 && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === node);
            if (inputRef.current && visible) inputRef.current.focus();
            else if (attempts++ < 20) timer = setTimeout(focusWhenVisible, 50);
        };
        focusWhenVisible();
        return () => { if (timer) clearTimeout(timer); };
    }, [searchRequest]);

    const openResult = React.useCallback(async (result: SearchResult, match?: SearchMatch) => {
        if (openingSessionId) return;
        setOpeningSessionId(result.sessionId);
        setOpenError(false);
        try {
            await sessionSearch.openSession(result.sessionId, match?.seq);
            if (!mounted.current) return;
            router.push({
                pathname: '/session/[id]',
                // Keep searched words local: URLs are visible to server logs.
                params: {
                    id: result.sessionId,
                    ...(match ? { searchMessageId: match.messageId, searchSeq: String(match.seq), ...(match.blockIndex !== undefined ? { searchBlockIndex: String(match.blockIndex) } : {}) } : {}),
                },
            });
            inputRef.current?.blur();
        } catch {
            if (mounted.current) setOpenError(true);
        } finally {
            if (mounted.current) setOpeningSessionId(null);
        }
    }, [deferredQuery, openingSessionId, router]);

    const renderResult = React.useCallback(({ item }: { item: SearchResult }) => (
        <View style={styles.result} testID="session-search-result">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.title}
                onPress={() => void openResult(item)}
                disabled={openingSessionId !== null}
                style={({ pressed }) => [styles.resultHeader, pressed && styles.pressed]}
            >
                <View style={styles.resultHeading}>
                    <Text style={styles.title} numberOfLines={2}><HighlightedText text={item.title} query={deferredQuery} /></Text>
                    {openingSessionId === item.sessionId && <ActivityIndicator size="small" color={theme.colors.textSecondary} />}
                </View>
                <View style={styles.resultMetadata}>
                    {item.archived && <Text style={styles.badge}>{t('sessionSearch.archived')}</Text>}
                    <Text style={styles.secondary}>{new Date(item.updatedAt).toLocaleDateString()}</Text>
                    {item.titleMatch && <Text style={styles.secondary}>{t('sessionSearch.titleMatch')}</Text>}
                </View>
            </Pressable>
            {item.matches.slice(0, expandedResults.has(`${deferredQuery}:${item.sessionId}`) ? undefined : 3).map((match, index) => (
                <Pressable
                    key={`${match.messageId}-${index}`}
                    accessibilityRole="button"
                    onPress={() => void openResult(item, match)}
                    disabled={openingSessionId !== null}
                    style={({ pressed }) => [styles.match, pressed && styles.pressed]}
                >
                    <View style={styles.matchHeading}>
                        <Text style={styles.author}>{match.role === 'user' ? t('sessionSearch.you') : t('sessionSearch.agent')}</Text>
                        <Ionicons name="arrow-forward" size={14} color={theme.colors.textSecondary} />
                    </View>
                    <Text style={styles.excerpt} numberOfLines={4}>
                        <HighlightedText text={searchExcerpt(match.text, deferredQuery)} query={deferredQuery} />
                    </Text>
                </Pressable>
            ))}
            {item.matches.length > 3 && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: expandedResults.has(`${deferredQuery}:${item.sessionId}`) }}
                    aria-expanded={expandedResults.has(`${deferredQuery}:${item.sessionId}`)}
                    onPress={() => setExpandedResults((previous) => {
                        const next = new Set(previous);
                        const key = `${deferredQuery}:${item.sessionId}`;
                        if (next.has(key)) next.delete(key); else next.add(key);
                        return next;
                    })}
                    style={styles.moreMatchesButton}
                >
                    <Text style={styles.link}>{expandedResults.has(`${deferredQuery}:${item.sessionId}`) ? t('sessionSearch.fewerMatches') : t('sessionSearch.moreMatches', { count: item.matches.length - 3 })}</Text>
                </Pressable>
            )}
        </View>
    ), [deferredQuery, openingSessionId, openResult, expandedResults, theme.colors.textSecondary]);

    return (
        <View style={styles.container}>
            <View style={styles.searchBarWrapper}>
                <View style={styles.searchBar}>
                    <Ionicons name="search-outline" size={18} color={theme.colors.textSecondary} />
                    <TextInput
                        ref={inputRef}
                        testID="session-search-input"
                        accessibilityLabel={t('sessionSearch.placeholder')}
                        placeholder={t('sessionSearch.placeholder')}
                        placeholderTextColor={theme.colors.textSecondary}
                        value={query}
                        onChangeText={setQuery}
                        onFocus={() => setIsOpen(true)}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="search"
                        style={styles.input}
                    />
                    {query.length > 0 && (
                        <Pressable accessibilityRole="button" accessibilityLabel={t('sessionSearch.clear')} hitSlop={8} onPress={() => setQuery('')}>
                            <Ionicons name="close-circle" size={18} color={theme.colors.textSecondary} />
                        </Pressable>
                    )}
                </View>
                {isOpen && (
                    <Pressable accessibilityRole="button" onPress={closeSearch} style={styles.cancel}>
                        <Text style={styles.link}>{t('common.cancel')}</Text>
                    </Pressable>
                )}
            </View>
            {isOpen ? (
                <View style={styles.searchContent}>
                    <View style={styles.filters}>
                        <Pressable
                            testID="session-search-agent-toggle"
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: includeAgentReplies }}
                            aria-checked={includeAgentReplies}
                            accessibilityLabel={t('sessionSearch.includeAgentReplies')}
                            onPress={() => setIncludeAgentReplies((value) => !value)}
                            style={styles.filterToggle}
                        >
                            <Ionicons name={includeAgentReplies ? 'checkbox' : 'square-outline'} size={20} color={includeAgentReplies ? theme.colors.accent : theme.colors.textSecondary} />
                            <Text style={styles.filterLabel}>{t('sessionSearch.includeAgentReplies')}</Text>
                        </Pressable>
                        <Text style={styles.coverage}>{t(snapshot.allHistory ? 'sessionSearch.allHistory' : 'sessionSearch.recentHistory')}</Text>
                        <Pressable accessibilityRole="button" onPress={() => void sessionSearch.start({ allHistory: !snapshot.allHistory }).catch(() => {})} style={styles.olderButton}>
                            <Text style={styles.link}>{t(snapshot.allHistory ? 'sessionSearch.searchRecent' : 'sessionSearch.searchOlder')}</Text>
                            <Ionicons name="arrow-forward" size={14} color={theme.colors.textLink} />
                        </Pressable>
                    </View>
                    {snapshot.isIndexing && (
                        <View style={styles.status} accessibilityLiveRegion="polite">
                            <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                            <Text style={styles.statusText}>{t('sessionSearch.indexing', { indexed: snapshot.indexedSessions, total: snapshot.totalSessions })}</Text>
                        </View>
                    )}
                    {(snapshot.error || openError) && (
                        <View style={styles.status} accessibilityLiveRegion="polite">
                            <Text style={styles.error}>{t(openError ? 'sessionSearch.openError' : 'sessionSearch.indexError')}</Text>
                            {!openError && <Pressable accessibilityRole="button" onPress={() => void sessionSearch.start().catch(() => {})}><Text style={styles.link}>{t('common.retry')}</Text></Pressable>}
                        </View>
                    )}
                    <FlatList
                        data={results}
                        keyExtractor={(item) => item.sessionId}
                        renderItem={renderResult}
                        keyboardShouldPersistTaps="handled"
                        keyboardDismissMode="on-drag"
                        contentContainerStyle={styles.results}
                        ListHeaderComponent={deferredQuery && results.length > 0 ? <Text style={styles.resultCount}>{t('sessionSearch.resultCount', { count: results.length })}</Text> : null}
                        ListEmptyComponent={(
                            <View style={styles.empty}>
                                <Ionicons name="search-outline" size={28} color={theme.colors.textSecondary} />
                                <Text style={styles.emptyTitle}>{t(deferredQuery ? 'sessionSearch.noResults' : 'sessionSearch.startTitle')}</Text>
                                <Text style={styles.emptyDescription}>{t(deferredQuery ? (snapshot.isIndexing ? 'sessionSearch.noResultsWhileIndexing' : 'sessionSearch.noResultsDescription') : 'sessionSearch.startDescription')}</Text>
                            </View>
                        )}
                    />
                </View>
            ) : children}
        </View>
    );
});

function HighlightedText({ text, query }: { text: string; query: string }) {
    return <>{highlightSearchText(text, query).map((part, index) => <Text key={index} style={part.highlighted ? styles.highlight : undefined}>{part.text}</Text>)}</>;
}

const styles = StyleSheet.create((theme) => ({
    container: { flex: 1, backgroundColor: theme.colors.groupped.background },
    searchBarWrapper: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 8, width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center' },
    searchBar: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.colors.surfaceHigh, borderRadius: 10, paddingHorizontal: 10, minHeight: 40 },
    input: { flex: 1, minWidth: 0, paddingVertical: 10, fontSize: 14, color: theme.colors.text, ...Typography.default(), ...(Platform.OS === 'web' ? { outlineWidth: 0 } : {}) },
    cancel: { minHeight: 40, justifyContent: 'center' },
    link: { fontSize: 13, color: theme.colors.textLink, ...Typography.default('semiBold') },
    searchContent: { flex: 1, width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center' },
    filters: { paddingHorizontal: 16, paddingBottom: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.divider },
    filterToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36, alignSelf: 'flex-start' },
    filterLabel: { color: theme.colors.text, fontSize: 13, ...Typography.default() },
    coverage: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 17, ...Typography.default() },
    olderButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 30, alignSelf: 'flex-start' },
    status: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
    statusText: { flex: 1, fontSize: 12, color: theme.colors.textSecondary, ...Typography.default() },
    error: { flex: 1, fontSize: 12, color: theme.colors.textDestructive, ...Typography.default() },
    results: { padding: 12, paddingBottom: 28 },
    resultCount: { color: theme.colors.textSecondary, fontSize: 12, paddingHorizontal: 4, paddingBottom: 10, ...Typography.default() },
    result: { borderRadius: 12, overflow: 'hidden', backgroundColor: theme.colors.surface, marginBottom: 10, borderWidth: 1, borderColor: theme.colors.divider },
    resultHeader: { padding: 12, gap: 6 },
    resultHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { flex: 1, color: theme.colors.text, fontSize: 14, lineHeight: 20, ...Typography.default('semiBold') },
    resultMetadata: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    secondary: { color: theme.colors.textSecondary, fontSize: 11, ...Typography.default() },
    badge: { backgroundColor: theme.colors.surfaceHigh, color: theme.colors.textSecondary, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, fontSize: 10, ...Typography.default() },
    match: { padding: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.divider, gap: 5 },
    matchHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    author: { fontSize: 11, color: theme.colors.textSecondary, ...Typography.default('semiBold') },
    excerpt: { fontSize: 13, lineHeight: 19, color: theme.colors.text, ...Typography.default() },
    highlight: { backgroundColor: theme.colors.accentSoft, color: theme.colors.text, ...Typography.default('semiBold') },
    pressed: { backgroundColor: theme.colors.surfacePressed },
    moreMatchesButton: { minHeight: 40, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center' },
    empty: { paddingHorizontal: 16, paddingVertical: 36, alignItems: 'center', gap: 10 },
    emptyTitle: { fontSize: 15, color: theme.colors.text, textAlign: 'center', ...Typography.default('semiBold') },
    emptyDescription: { fontSize: 13, lineHeight: 20, color: theme.colors.textSecondary, textAlign: 'center', ...Typography.default() },
}));
