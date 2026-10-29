#!/usr/bin/env node
// 用法：node scripts/pixel-pet/validate.mjs <文件.json | 内置id> [更多文件…]
// 校验通过时打印摘要；失败时打印中文错误并以退出码 1 结束。
import { loadPet, sprite } from './lib.mjs';

const refs = process.argv.slice(2);
if (!refs.length) {
  console.error('用法：node scripts/pixel-pet/validate.mjs <文件.json | 内置id> [更多文件…]');
  process.exit(2);
}
let failed = 0;
for (const ref of refs) {
  try {
    const spec = await loadPet(ref);
    const eyes = Object.keys(spec.eyes).length, colors = Object.keys(spec.palette).length;
    console.log(`✓ ${ref}：${spec.name}（${spec.id}）${spec.size[0]}×${spec.size[1]}，${colors} 色，${eyes} 种眼睛，${spec.legs?.length ?? 0} 帧腿，${spec.extras?.length ?? 0} 个附件`);
    const missing = sprite.PIXEL_EYE_STATES.filter(s => !(s in spec.eyes));
    if (missing.length) console.log(`  提示：以下眼睛状态将自动推导或回退为中性：${missing.join('、')}`);
  } catch (error) {
    failed++;
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  }
}
process.exit(failed ? 1 : 0);
