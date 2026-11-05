export function requestScope(signal: AbortSignal | undefined, timeout: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeout);
  return { signal: controller.signal, dispose() { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
}

export function checkRequest(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
}
