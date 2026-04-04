/* ──────────────────────────────────────────────────────────────────
   Help Engine — barrel export
   ────────────────────────────────────────────────────────────────── */

export { loadKnowledgeBase, reloadKnowledgeBase, searchKnowledgeBase } from './knowledge-base';
export type { HelpManifest, SearchResult } from './knowledge-base';

export { answerHelpQuestion, isHelpQuestion, getHelpTopics } from './help-responder';
export type { HelpResponse } from './help-responder';
