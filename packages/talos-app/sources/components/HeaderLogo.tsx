import * as React from 'react';
import { TalosMark } from './TalosBrand';

/** Stable across tab switches. */
export const HeaderLogo = React.memo(() => <TalosMark size={32} />);
