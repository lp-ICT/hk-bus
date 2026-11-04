export type ConnectionIssue = { source: string; reason: string; at: number; backupAt?: string };
let issues: ConnectionIssue[] = [];
const listeners = new Set<() => void>();
export const connectionIssues = () => issues;
export function subscribeConnection(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function reportConnection(source: string, reason?: string, backupAt?: string) {
  issues = issues.filter(issue => issue.source !== source);
  if (reason) issues = [...issues, { source, reason, at: Date.now(), backupAt }];
  issues = [...issues.filter(issue => issue.backupAt), ...issues.filter(issue => !issue.backupAt).slice(-8)];
  for (const listener of listeners) listener();
}
export function connectionReason(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') return '連線逾時';
  if (error instanceof TypeError) return '連線失敗（瀏覽器未提供詳細原因）';
  return error instanceof Error ? error.message : '資料讀取失敗';
}
