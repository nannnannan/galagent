export const MIRA_DEFAULT_BASE_URL = 'http://127.0.0.1:18890/v1';
export const MIRA_DEFAULT_MODEL = 'kimi-k3.1-pro';

/** Old K3 IDs stay on K3; this only selects compatible request parameters. */
export function isKimiK3Model(model: string): boolean {
  return /^(kimi-code\/k3|kimi-k3|k3)(?:$|[-_])/i.test(model)
    || /^(kimi-k3\.1-pro|kimi-code\/k3\.1(?:-pro)?|k3\.1(?:-pro)?)$/i.test(model);
}
