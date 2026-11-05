export async function reloadLatestPage() {
  if ('serviceWorker' in navigator) {
    await Promise.race([
      navigator.serviceWorker.getRegistration().then(registration => registration?.update()).catch(() => {}),
      new Promise(resolve => setTimeout(resolve, 3000)),
    ]);
  }
  const url = new URL(window.location.href);
  url.searchParams.set('_reload', String(Date.now()));
  window.location.replace(url.href);
}
