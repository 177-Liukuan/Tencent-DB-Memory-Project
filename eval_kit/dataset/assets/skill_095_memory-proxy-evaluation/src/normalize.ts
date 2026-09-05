import { isBusinessTool, type BusinessTool } from './tool-registry.js';
export function normalizeNative(name: string): BusinessTool | null { return isBusinessTool(name) ? name : null; }
export function normalizeBaseline(command: string): BusinessTool | null { const m = command.match(/\/(tdai_memory_search|tdai_conversation_search|skill_search|skill_view|skill_files_read)(?:\?|\s|$)/); return m && isBusinessTool(m[1]) ? m[1] : null; }

