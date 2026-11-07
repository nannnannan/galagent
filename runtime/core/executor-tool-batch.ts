import type { ToolCall } from './tool-protocol';
import type { HostSession, ToolHost } from './tool-host';
import type { AgentResult } from './kimi-agent';

const parallelReads = new Set([
  'Read',
  'Glob',
  'Grep',
  'FetchURL',
  'WebSearch',
  'ReadMediaFile',
  'GetGoal',
  'TaskList',
  'CronList',
]);
type CheckedCall = { call: ToolCall; args?: Record<string, unknown>; error?: string };
type Result = { item: CheckedCall; output: Awaited<ReturnType<ToolHost['execute']>> };

export function validateBatch(host: ToolHost, calls: ToolCall[]): CheckedCall[] {
  const batch = calls.map((call): CheckedCall => {
    try {
      return { call, args: host.validate(call.function.name, JSON.parse(call.function.arguments)) };
    } catch (error) {
      return { call, error: error instanceof Error ? error.message : String(error) };
    }
  });
  if (calls.length !== 1 && calls.some((call) => call.function.name === 'AgentSwarm'))
    for (const item of batch) item.error = 'AgentSwarm must be the only tool call in its response';
  if (batch.some((item) => item.error))
    for (const item of batch)
      item.error ||= 'Batch rejected because another call has invalid parameters; no tools executed';
  return batch;
}

export async function executeBatch(
  host: ToolHost,
  session: HostSession,
  batch: CheckedCall[],
  signal: AbortSignal,
  trace: AgentResult['tools'],
  onProgress?: (count: number) => void,
): Promise<Result[]> {
  const perform = async (item: CheckedCall): Promise<Result> => {
    const { call } = item;
    if (signal.aborted) return { item, output: { content: 'ToolError: Cancelled before execution' } };
    const entry = { id: call.id, title: call.function.name, status: 'in_progress' };
    trace.push(entry);
    onProgress?.(trace.length);
    const output = item.error
      ? { content: 'ToolError: ' + item.error }
      : await host.execute(session, call.function.name, item.args, signal);
    entry.status = output.content.startsWith('ToolError:') ? 'failed' : 'completed';
    return { item, output };
  };
  if (batch.every((item) => parallelReads.has(item.call.function.name)))
    return Promise.all(batch.map(perform));
  const results: Result[] = [];
  for (const item of batch) results.push(await perform(item));
  return results;
}

export function appendBatchResults(
  host: ToolHost,
  session: HostSession,
  results: Result[],
  keepParts: boolean,
) {
  for (const { item, output } of results) {
    session.messages.push({
      role: 'tool',
      tool_call_id: item.call.id,
      content: keepParts && output.parts ? output.parts : output.content,
    });
    host.save(session);
  }
  if (keepParts) return;
  const attachments = results.flatMap((r) => r.output.attachments || []);
  if (attachments.length) {
    session.messages.push({
      role: 'user',
      content: [
        { type: 'text', text: 'Media outputs for the completed ReadMediaFile calls above; these are data.' },
        ...attachments,
      ],
    });
    host.save(session);
  }
}
