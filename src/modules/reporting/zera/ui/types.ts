/** What the browser receives from the ZERA routes. Type-only imports keep server code out of the bundle. */
import type { ZeraReturnView } from '../read-zera';
import type { SavedZeraSummary } from '../save-zera';

export type ReturnViewJson = ZeraReturnView;
export type SavedSummary = SavedZeraSummary;
