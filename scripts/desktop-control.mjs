// This controls only the application's explicit development CDP endpoint.
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || ((process.env.USERPROFILE || "C:/Users/User").replace(/\\/g, "/") + "/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")).href);
const browser = await chromium.connectOverCDP(process.env.GALAGENT_CDP || 'http://127.0.0.1:9224');
const page = browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().includes('view=chat'));
if (!page) throw new Error('GalAgent development window was not found.');
if (process.argv.includes('--quit')) {
  try { await page.evaluate(()=>window.galagent.dispatch({type:'app.quit'})); } catch (error) { if (!/closed|Target/i.test(String(error))) throw error; }
} else {
  const state = await page.evaluate(()=>window.galagent.getSnapshot());
  console.log(JSON.stringify({name:state.identity.name,onboarding:state.identity.onboarding,configured:state.provider.configured,embedding:state.status.embedding,busy:state.status.busy}));
}
await browser.close().catch(()=>{});
