import { useSyncExternalStore } from 'react';
import { connectionIssues, subscribeConnection } from '../lib/connection';

export default function ConnectionStatus() {
  const issues = useSyncExternalStore(subscribeConnection, connectionIssues);
  if (!issues.length) return null;
  const backup = issues.some(issue => issue.backupAt);
  return <aside className="connection-status" aria-label="資料連線狀態">
    <p>{backup ? '部分路線／車站使用備援資料；到站時間仍需即時連線。' : '部分巴士資料連線失敗，請稍後更新。'}</p>
    <details><summary>查看連線詳情（回報問題時請連同版本截圖）</summary>
      <p>版本 {import.meta.env.VITE_APP_VERSION} · {navigator.onLine ? '裝置顯示已連線' : '裝置顯示離線'}</p>
      <ul>{issues.map(issue => <li key={issue.source}><strong>{issue.source}</strong><br />{issue.reason} · {new Date(issue.at).toLocaleTimeString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false })}{issue.backupAt && <><br />備援資料日期：{new Date(issue.backupAt).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false })}</>}</li>)}</ul>
      <p>「連線失敗」未能單憑此畫面分辨網絡、跨網站存取限制或官方服務問題。</p>
    </details>
  </aside>;
}
