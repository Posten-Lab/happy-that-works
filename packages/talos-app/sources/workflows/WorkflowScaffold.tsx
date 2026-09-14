import React from 'react';
import { Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Typography } from '@/constants/Typography';
import { WorkflowButton, useWorkflowStyles } from './ui';

/** Keep the focused field and the primary action above the software keyboard. */
export function WorkflowScaffold({ children, footer, scrollRef, maxWidth = 1040 }: {
    children: React.ReactNode;
    footer?: React.ReactNode;
    scrollRef?: React.Ref<ScrollView>;
    maxWidth?: number;
}) {
    const s = useWorkflowStyles(), insets = useSafeAreaInsets();
    const window = useWindowDimensions(), frame = React.useRef<View>(null);
    const [bottomGap, setBottomGap] = React.useState(0);
    const [footerHeight, setFooterHeight] = React.useState(100);
    const paddingBottom = footer ? footerHeight + 28 : 32 + insets.bottom;
    const contentStyle = { padding: window.width >= 900 ? 32 : 20, paddingTop: 24, paddingBottom, gap: 24, width: '100%' as const, maxWidth, alignSelf: 'center' as const };
    return <View ref={frame} onLayout={() => { if (Platform.OS !== 'web') frame.current?.measureInWindow((_x, y, _width, height) => setBottomGap(Math.max(0, window.height - y - height))); }} style={{ flex: 1, backgroundColor: s.colors.groupped.background }}>
        {Platform.OS === 'web'
            ? <ScrollView ref={scrollRef} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={contentStyle}>{children}</ScrollView>
            : <KeyboardAwareScrollView ref={node => { if (typeof scrollRef === 'function') scrollRef(node); else if (scrollRef) scrollRef.current = node; }} style={{ flex: 1 }} bottomOffset={footer ? footerHeight + bottomGap + 44 : 32}
                keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={contentStyle}>{children}</KeyboardAwareScrollView>}
        {footer && <KeyboardStickyView offset={{ opened: bottomGap }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
            <View onLayout={e => setFooterHeight(e.nativeEvent.layout.height)} style={{ backgroundColor: s.colors.surface, borderTopWidth: 1, borderColor: s.colors.divider, paddingBottom: Math.max(12, insets.bottom), paddingTop: 12 }}>
                <View style={{ width: '100%', maxWidth, alignSelf: 'center', paddingHorizontal: window.width >= 900 ? 32 : 20, gap: 8 }}>{footer}</View>
            </View>
        </KeyboardStickyView>}
    </View>;
}

export function WorkflowPageHeading({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) {
    const s = useWorkflowStyles();
    return <View style={{ gap: 8 }}>
        {!!eyebrow && <Text style={{ ...s.muted, ...Typography.header(), fontSize: 11, letterSpacing: 1.4, color: s.colors.accent }}>{eyebrow.toUpperCase()}</Text>}
        <Text accessibilityRole="header" style={{ ...s.text, ...Typography.header(), fontSize: 28, lineHeight: 34, letterSpacing: -0.6 }}>{title}</Text>
        {!!description && <Text style={{ ...s.muted, fontSize: 15, lineHeight: 23 }}>{description}</Text>}
    </View>;
}

export function WorkflowNotice({ title, message, action, onAction }: { title: string; message: string; action?: string; onAction?: () => void }) {
    const s = useWorkflowStyles();
    return <View accessibilityRole="alert" style={{ ...s.card, borderColor: s.colors.accent, gap: 8 }}>
        <Text style={{ ...s.text, ...Typography.header() }}>{title}</Text>
        <Text style={s.muted}>{message}</Text>
        {action && onAction && <WorkflowButton label={action} onPress={onAction} />}
    </View>;
}
