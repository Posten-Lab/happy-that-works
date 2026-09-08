import * as React from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { UsageProvider } from '@ahmadposten/talos-wire';
import { Text } from '@/components/StyledText';

interface ProviderPage {
    id: UsageProvider;
    label: string;
    content: React.ReactNode;
}

interface UsageProviderCarouselProps {
    pages: ProviderPage[];
    width: number;
    selectedProvider: UsageProvider;
    onSelect: (provider: UsageProvider) => void;
}

const styles = StyleSheet.create((theme) => ({
    container: { gap: 16 },
    tabs: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 16, backgroundColor: theme.colors.surfaceHigh },
    tab: { flex: 1, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    selectedTab: { backgroundColor: theme.colors.surface },
    label: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: theme.colors.textSecondary },
    selectedLabel: { color: theme.colors.text },
    pager: { flexGrow: 0, flexShrink: 0 },
    pages: { alignItems: 'flex-start' },
}));

/** Keep provider cards mounted while swiping, but only expose the selected page
 * to assistive technology and size the viewport to that page's natural height. */
export function UsageProviderCarousel({ pages, width, selectedProvider, onSelect }: UsageProviderCarouselProps) {
    const { theme } = useUnistyles();
    const scroll = React.useRef<ScrollView>(null);
    const tabs = React.useRef<Record<string, View | null>>({});
    const settleTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const [heights, setHeights] = React.useState<Record<string, { width: number; height: number }>>({});
    const selectedIndex = Math.max(0, pages.findIndex(page => page.id === selectedProvider));
    const selectedIndexRef = React.useRef(selectedIndex);
    selectedIndexRef.current = selectedIndex;
    const pageIds = pages.map(page => page.id).join(',');

    React.useLayoutEffect(() => {
        // Rotation and provider discovery can change offsets without changing
        // which provider the user chose. Cancel any scroll from the old layout.
        clearTimeout(settleTimer.current);
        scroll.current?.scrollTo({ x: selectedIndexRef.current * width, animated: false });
        return () => clearTimeout(settleTimer.current);
    }, [width, pageIds]);

    const selectPage = (index: number) => {
        clearTimeout(settleTimer.current);
        onSelect(pages[index].id);
        scroll.current?.scrollTo({ x: index * width, animated: false });
    };
    const settlePage = (offset: number) => {
        const index = Math.max(0, Math.min(pages.length - 1, Math.round(offset / width)));
        onSelect(pages[index].id);
    };
    const measured = heights[pages[selectedIndex].id];
    const height = measured?.width === width ? measured.height : undefined;

    return <View style={styles.container} testID="usage-provider-carousel">
        <View style={styles.tabs} accessibilityRole="tablist" accessibilityLabel="Usage providers">
            {pages.map((page, index) => {
                const selected = index === selectedIndex;
                return <Pressable
                    key={page.id}
                    ref={node => { tabs.current[page.id] = node; }}
                    nativeID={`usage-tab-${page.id}`}
                    testID={`usage-tab-${page.id}`}
                    accessibilityRole="tab"
                    accessibilityLabel={page.label}
                    accessibilityState={{ selected }}
                    {...(Platform.OS === 'web' ? {
                        tabIndex: selected ? 0 as const : -1 as const,
                        'aria-selected': selected,
                        'aria-controls': `usage-page-${page.id}`,
                        onKeyDown: (event: React.KeyboardEvent) => {
                            const next = event.key === 'ArrowRight' ? (index + 1) % pages.length
                                : event.key === 'ArrowLeft' ? (index - 1 + pages.length) % pages.length
                                    : event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : null;
                            if (next === null) return;
                            event.preventDefault();
                            selectPage(next);
                            tabs.current[pages[next].id]?.focus();
                        },
                    } : {})}
                    onPress={() => selectPage(index)}
                    style={({ pressed }) => [styles.tab, selected && styles.selectedTab, pressed && { backgroundColor: theme.colors.surfacePressed }]}
                >
                    <Text style={[styles.label, selected && styles.selectedLabel]}>{page.label}</Text>
                </Pressable>;
            })}
        </View>
        <ScrollView
            ref={scroll}
            testID="usage-provider-pager"
            horizontal
            pagingEnabled
            directionalLockEnabled
            showsHorizontalScrollIndicator={false}
            scrollsToTop={false}
            style={[styles.pager, { width, height }]}
            contentContainerStyle={styles.pages}
            scrollEventThrottle={16}
            onScroll={event => {
                const offset = event.nativeEvent.contentOffset.x;
                clearTimeout(settleTimer.current);
                // React Native Web does not emit onMomentumScrollEnd.
                settleTimer.current = setTimeout(() => settlePage(offset), 150);
            }}
            onMomentumScrollEnd={event => {
                clearTimeout(settleTimer.current);
                settlePage(event.nativeEvent.contentOffset.x);
            }}
        >
            {pages.map((page, index) => <View
                key={page.id}
                nativeID={`usage-page-${page.id}`}
                accessibilityElementsHidden={index !== selectedIndex}
                importantForAccessibility={index === selectedIndex ? 'auto' : 'no-hide-descendants'}
                {...(Platform.OS === 'web' ? {
                    role: 'tabpanel' as const,
                    'aria-labelledby': `usage-tab-${page.id}`,
                    'aria-hidden': index !== selectedIndex,
                    inert: index !== selectedIndex,
                } : {})}
                style={{ width, flexShrink: 0 }}
                onLayout={event => {
                    const measuredHeight = event.nativeEvent.layout.height;
                    setHeights(previous => previous[page.id]?.width === width && previous[page.id]?.height === measuredHeight
                        ? previous : { ...previous, [page.id]: { width, height: measuredHeight } });
                }}
            >{page.content}</View>)}
        </ScrollView>
    </View>;
}
