import * as React from 'react';
import { useRoute } from "@react-navigation/native";
import { SessionView } from '@/-session/SessionView';


export default React.memo(() => {
    const route = useRoute();
    const params = route.params as { id: string; searchMessageId?: string; searchSeq?: string; searchBlockIndex?: string };
    return (<SessionView id={params.id} searchMessageId={params.searchMessageId} searchSeq={params.searchSeq ? Number(params.searchSeq) : undefined} searchBlockIndex={params.searchBlockIndex !== undefined ? Number(params.searchBlockIndex) : undefined} />);
});
