// Child processes must not inherit API keys or tokens supplied through the environment:
// they would surface in tool output, which is persisted to SQLite and fed back to the model.
export const safeChildEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/(API_?KEY|TOKEN|SECRET|PASSWORD)$/i.test(k)));
