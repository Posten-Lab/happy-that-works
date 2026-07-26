import * as React from 'react';
import { ToolViewProps } from './_all';
import { TodoItemsList } from './TodoView';
import { parseTaskList, toResultText } from '@/sync/reducer/taskTools';

/**
 * Renders a `TaskList` call as the same checklist TodoWrite used to produce.
 * TaskList reports plain text rather than a structured payload, so the result
 * is parsed here (see sync/reducer/taskTools).
 */
export const TaskListView = React.memo<ToolViewProps>(({ tool }) => {
    const items = React.useMemo(() => {
        const text = toResultText(tool.result);
        return text ? parseTaskList(text) : [];
    }, [tool.result]);

    return <TodoItemsList items={items} />;
});
