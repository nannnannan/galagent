// Opt-in live probes use an explicitly selected endpoint and a synthetic profile.
export function liveProvider() {
  const { GALAGENT_TEST_API_BASE_URL: baseUrl, GALAGENT_TEST_MODEL: model, GALAGENT_TEST_API_KEY: apiKey } = process.env;
  if (!baseUrl?.trim() || !model?.trim() || !apiKey?.trim()) {
    throw new Error('请为真实接口测试设置 GALAGENT_TEST_API_BASE_URL、GALAGENT_TEST_MODEL 和 GALAGENT_TEST_API_KEY');
  }
  return { baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey.trim() };
}
