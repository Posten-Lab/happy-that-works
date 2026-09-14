import * as React from 'react';
import { useRouter } from 'expo-router';
import { useFriendRequests } from '@/sync/storage';
import { useIsTablet } from '@/utils/responsive';
import { TabBar, type TabType } from './TabBar';

/** The home destinations remain reachable from the workflow library on phones. */
export const HomeTabBar = React.memo(({ activeTab }: { activeTab: TabType }) => {
    const router = useRouter();
    const isTablet = useIsTablet();
    const friendRequests = useFriendRequests();
    const handleTabPress = React.useCallback((tab: TabType) => {
        if (tab === activeTab) return;
        if (tab === 'workflows') router.navigate('/workflows');
        else router.navigate({ pathname: '/', params: { tab } });
    }, [activeTab, router]);

    if (isTablet) return null;
    return <TabBar activeTab={activeTab} onTabPress={handleTabPress} inboxBadgeCount={friendRequests.length} />;
});
