import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

type Selection = { appData: string; argv: string[]; environment?: string; applicationDir: string };

/** The remembered selection belongs to the user, independently of the executable or its working directory. */
export function selectProfile(input: Selection) {
  const selector = path.join(input.appData, 'GalAgent-profile.json');
  const explicit = input.argv.find(arg => arg.startsWith('--profile-directory='))?.slice('--profile-directory='.length);
  const remember = input.argv.includes('--remember-profile');
  if (remember && !explicit) throw new Error('保存存档选择需要明确的 --profile-directory 路径');
  let directory = explicit || input.environment;
  let remembered = false;
  if (!directory && existsSync(selector)) {
    let saved: unknown;
    try { saved = JSON.parse(readFileSync(selector,'utf8').replace(/^\uFEFF/,'')); }
    catch { throw new Error('当前存档选择文件无法读取，请修复 GalAgent-profile.json；已停止启动，避免误开其他存档。'); }
    if (!saved || typeof saved !== 'object' || (saved as {version?:unknown}).version !== 1 ||
        typeof (saved as {directory?:unknown}).directory !== 'string') throw new Error('当前存档选择格式无效');
    directory = (saved as {directory:string}).directory;
    remembered = true;
  }
  directory ||= path.join(input.appData,'GalAgent');
  if (!path.isAbsolute(directory)) throw new Error('存档位置必须是绝对路径');
  directory = path.resolve(directory);
  const relative = path.relative(path.resolve(input.applicationDir),directory);
  if (!relative || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative)))
    throw new Error('存档需要放在程序安装目录之外');
  if (remembered && !existsSync(directory)) throw new Error('上次使用的存档位置不存在，请恢复该目录；已停止启动，避免创建错误的空白存档。');
  mkdirSync(directory,{recursive:true});
  if (!statSync(directory).isDirectory()) throw new Error('存档位置不是文件夹');
  if (remember) {
    mkdirSync(input.appData,{recursive:true});
    const temporary=selector+'.'+randomUUID();
    writeFileSync(temporary,JSON.stringify({version:1,directory},null,2),'utf8');
    renameSync(temporary,selector);
  }
  return {directory,selector,isolated:!!input.environment && !explicit,remembered:remembered||remember};
}
