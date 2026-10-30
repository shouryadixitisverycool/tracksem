import { AttemptLimiter } from './accounts';

/** Failed logins per roll number */
export const loginFailures = new AttemptLimiter(10, 15 * 60 * 1000);
/** New accounts per client address (behind a proxy without ADDRESS_HEADER this is one shared bucket) */
export const registrations = new AttemptLimiter(20, 60 * 60 * 1000);
/** Wrong current-password attempts per user */
export const passwordChanges = new AttemptLimiter(10, 15 * 60 * 1000);
/** MCP requests per token or OAuth grant */
export const agentRequests = new AttemptLimiter(600, 10 * 60 * 1000);
/** OAuth dynamic client registrations per client address */
export const oauthRegistrations = new AttemptLimiter(30, 60 * 60 * 1000);
/** Failed OAuth token requests per client id */
export const oauthTokenFailures = new AttemptLimiter(30, 15 * 60 * 1000);
