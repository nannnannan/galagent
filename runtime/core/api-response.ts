import { abortable } from './pool';

export async function responseText(response: Response, signal: AbortSignal, limit = 16_000_000) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '',
    size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await abortable(reader.read(), signal);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new Error('模型响应超过大小上限');
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export async function apiFailure(
  response: Response,
  signal: AbortSignal,
  key: string,
  redact: (text: string) => string = (text) => text,
) {
  let message = '',
    param = '';
  try {
    const text = await responseText(response, signal, 8192);
    try {
      const body = JSON.parse(text),
        error = body.error ?? body;
      message = typeof error === 'string' ? error : typeof error.message === 'string' ? error.message : '';
      param = typeof error.param === 'string' ? error.param : '';
    } catch {
      if (!/^\s*</.test(text)) message = text.slice(0, 500);
    }
  } catch {
    signal.throwIfAborted();
  }
  const unsupported = message + ' ' + param;
  const tip =
    response.status === 401
      ? '密钥未通过验证，请检查 API Key'
      : response.status === 403
        ? '接口拒绝访问，请检查账号权限'
        : response.status === 404
          ? '接口或模型不存在，请检查地址与模型名'
          : response.status === 429
            ? '接口限流或额度不足，请稍后重试'
            : '模型接口请求失败';
  const safe = redact((key ? message.split(key).join('〔已隐藏密钥〕') : message).slice(0, 500)).slice(
    0,
    300,
  );
  return {
    unsupported,
    error: new Error(tip + '（HTTP ' + response.status + '）' + (safe ? '：' + safe : '')),
  };
}
