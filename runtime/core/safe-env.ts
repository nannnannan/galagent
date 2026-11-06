// Child processes must not inherit API keys or tokens supplied through the environment:
// they would surface in tool output, which is persisted to SQLite and fed back to the model.
export const safeChildEnv = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(env).filter(([k]) => !/(?:^|_)(?:API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_?KEY|ACCESS_?KEY|CLIENT_?KEY|CREDENTIAL|CREDENTIALS)(?:_|$)/i.test(k)));
