export async function fetchJsonWithTimeout(url, options = {}) {
  const {
    timeoutMs = 8_000,
    signal: externalSignal,
    fetchImpl = globalThis.fetch,
    init = {},
  } = options;

  const controller = new AbortController();
  let timedOut = false;
  const abortFromExternalSignal = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) abortFromExternalSignal();
  else externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Request timed out', 'TimeoutError'));
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } catch (error) {
    if (timedOut) throw new Error(`Délai de chargement dépassé (${timeoutMs} ms)`);
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromExternalSignal);
  }
}

const wait = (delayMs, signal) => new Promise((resolve, reject) => {
  if (!delayMs) { resolve(); return; }
  if (signal?.aborted) { reject(signal.reason || new DOMException('Aborted', 'AbortError')); return; }
  const finish = () => {
    signal?.removeEventListener('abort', abort);
    resolve();
  };
  const timer = setTimeout(finish, delayMs);
  const abort = () => {
    clearTimeout(timer);
    reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  };
  signal?.addEventListener('abort', abort, { once:true });
});

export async function fetchJsonWithRetry(url, options = {}) {
  const {
    attempts = 3,
    retryDelays = [350, 900],
    onRetry,
    signal,
    ...requestOptions
  } = options;

  let lastError;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    try {
      return await fetchJsonWithTimeout(url, { ...requestOptions, signal });
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      const status = Number(error?.status || 0);
      const retryable = !status || status >= 500 || status === 408 || status === 429;
      if (!retryable || attempt >= attempts) throw error;
      onRetry?.(attempt, error);
      await wait(Number(retryDelays[attempt - 1] || 0), signal);
    }
  }
  throw lastError;
}
