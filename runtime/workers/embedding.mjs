import { parentPort, workerData } from 'node:worker_threads';
let extractorPromise;
parentPort.on('message', async ({ id, text, query, op }) => {
  if (op === 'dispose') {
    try { const extractor = extractorPromise ? await extractorPromise : undefined; await extractor?.dispose(); } catch {}
    parentPort.postMessage({op:'disposed'}); return;
  }
  try {
    if (!extractorPromise) extractorPromise = (async () => {
        const { pipeline, env } = await import('@huggingface/transformers');
        env.cacheDir = workerData.cacheDir;
        env.allowRemoteModels = !workerData.modelPath;
        return pipeline('feature-extraction', workerData.modelPath || 'Xenova/multilingual-e5-small', { dtype: 'q8', device: 'cpu', session_options: { intraOpNumThreads: workerData.threads || 2, interOpNumThreads: 1, executionMode: 'sequential' } });
      })();
    const extractor = await extractorPromise;
    const output = await extractor(`${query ? 'query' : 'passage'}: ${text}`, { pooling: 'mean', normalize: true });
    parentPort.postMessage({ id, values: Array.from(output.data) });
  } catch (error) { parentPort.postMessage({ id, error: String(error?.message || error) }); }
});
