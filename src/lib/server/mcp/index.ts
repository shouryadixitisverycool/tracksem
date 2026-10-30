import { readTools } from './readTools';
import { writeTools } from './writeTools';
import type { Tool } from './types';

export const ALL_TOOLS: Tool[] = [...readTools, ...writeTools];
