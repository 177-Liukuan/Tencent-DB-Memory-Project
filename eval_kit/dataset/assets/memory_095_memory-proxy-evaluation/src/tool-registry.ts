export const BUSINESS_TOOLS = ['tdai_memory_search', 'tdai_conversation_search', 'skill_search', 'skill_view', 'skill_files_read'] as const;
export type BusinessTool = typeof BUSINESS_TOOLS[number];
export function isBusinessTool(x: string): x is BusinessTool { return (BUSINESS_TOOLS as readonly string[]).includes(x); }

