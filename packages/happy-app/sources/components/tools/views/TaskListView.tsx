import * as React from 'react';
import { ToolViewProps } from './_all';
import { TodoItemsList } from './TodoView';
import { parseTaskList, toResultText } from '@/sync/reducer/taskTools';

/**
 * Renders any TaskCreate/TaskUpdate/TaskList call as the checklist TodoWrite
 * used to produce.
 *
 * TodoWrite carried the whole list on every call, so the checklist appeared
 * inline throughout a conversation. The Task* tools each report only their own
 * task, so the reducer folds them into a running list and attaches it as
 * `taskSnapshot` — that is the preferred source here. A TaskList result is
 * parsed directly as a fallback, which also covers messages reduced before
 * snapshots existed.
 */
export const TaskListView = React.memo<ToolViewProps>(({ tool }) => {
    const items = React.useMemo(() => {
        if (tool.taskSnapshot && tool.taskSnapshot.length > 0) {
            return tool.taskSnapshot;
        }
        const text = toResultText(tool.result);
        return text ? parseTaskList(text) : [];
    }, [tool.taskSnapshot, tool.result]);

    return <TodoItemsList items={items} />;
});
