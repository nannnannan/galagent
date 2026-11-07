'use strict';
// Version-specific adapter. Reads the installed bundle; never edits it.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const selectionPath = path.join(__dirname, 'runtime-selection.json');
const selectedVersion = process.env.MIRA_BUNDLE_VERSION || (fs.existsSync(selectionPath) ? JSON.parse(fs.readFileSync(selectionPath, 'utf8').replace(/^\uFEFF/, '')).version : null);
if (selectedVersion && !/^\d+\.\d+\.\d+$/.test(selectedVersion)) throw new Error('Invalid Mira bundle selection');
const root = selectedVersion ? path.join(require('node:os').homedir(), '.mirasim', 'app', selectedVersion) : path.join(process.env.LOCALAPPDATA, 'Programs', '@mirasimdesktop', 'resources');
const filename = path.join(root, fs.existsSync(path.join(root, 'server-main.cjs')) ? 'server-main.cjs' : 'server.cjs');
const source = fs.readFileSync(filename, 'utf8');
const profiles = {
  'e71a736aab8d926f42e572193d8b10a02350268f65b0f58e0b735de55606507c': {
    version: '0.0.771', marker: 'oGi(),G8a(),U8a(process["argv"]["slice"](',
    exports: 'Xat();a7r();module.exports={sign:d3t,device:Eji,seal:HNi};',
  },
  '7c10bddc85a1ae534257ad0f16386c29f8cc0ae32a7358fc39403d1ab88fa83e': {
    version: '0.0.744', marker: 'yLi(),YBa(),zBa(process["argv"]["slice"](',
    exports: 'kit();u3r();module.exports={sign:w$t,device:LOi,seal:uEi};',
  },
  '541a5c3970557a8bc19d533efb0a0fcf8ae4a2232de4ca4ba9fc68f1fdee3b05': {
    version: '0.0.697', marker: 'vNi(),wSa(),ySa(process["argv"]["slice"](',
    exports: 'Rrt();P4r();module.exports={sign:WLt,device:ePi,seal:Pwi};',
  },
  '7039aeecf82fc72de742ca6e0e92186069e8d69f9952176ccae5087b06d70a10': {
    version: '0.0.626', marker: 'N0i(),Wea(),$ea(process["argv"]["slice"](',
    exports: 'FYe();JDr();module.exports={sign:MDt,device:w_i,seal:Rli};',
  },
  '02f16e82a9edd12b91de2e84f25a92fb147dce7d40d0bceaf6d6621c4a1f3276': {
    version: '0.0.622', marker: 'Kbi(),xZo(),CZo(process["argv"]["slice"](',
    exports: 'TYe();bDr();module.exports={sign:_Dt,device:Qyi,seal:Jci};',
  },
  '9afa9b4f25d9a4e40416b29bed80bbddb91511544c8a388fbc5f6e1aaa356882': {
    version: '0.0.620', marker: 'hvi(),jYo(),LYo(process["argv"]["slice"](',
    exports: 'lYe();RPr();module.exports={sign:UPt,device:tAi,seal:Dai};',
  },
  ad000a297cb250b2176f647959e09b8fa18e0c760c58a5c4e1717e54dc3802b3: {
    version: '0.0.447', entry: 'Fno', exports: 'n5e();qpr();module.exports={sign:B_t,device:i5n,seal:ZFn};',
  },
  '03248a0948abfa6b088587c3bb1f212004b5f814be2d07a9270809c20e274292': {
    version: '0.0.479', entry: 'Ulo', exports: 'kje();gmr();module.exports={sign:B0t,device:HGn,seal:k4n};',
  },
};
const sha256 = crypto.createHash('sha256').update(source).digest('hex');
const profile = profiles[sha256];
if (!profile) throw new Error('Mira bundle is not verified. Update the version profile before use. SHA256=' + sha256);
if (selectedVersion && profile.version !== selectedVersion) throw new Error('Selected version does not match verified bundle');
const marker = profile.marker || profile.entry + "(process['argv']['slice'](";
const end = source.lastIndexOf(marker);
if (end < 0) throw new Error('Unsupported Mira bundle entrypoint');
const mod = new Module(filename, module);
mod.filename = filename;
mod.paths = Module._nodeModulePaths(root);
mod._compile(source.slice(0, end) + '\n' + profile.exports, filename);
const native = mod.exports;
let cachedKey;
function loadAuth() {
  const cfg = JSON.parse(fs.readFileSync(path.join(require('node:os').homedir(), '.mirasim', 'setting.json'), 'utf8').replace(/^\uFEFF/, ''));
  const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $p=Join-Path $env:APPDATA '@mirasim\\desktop\\Local State'; $j=Get-Content -Raw -LiteralPath $p|ConvertFrom-Json; $b=[Convert]::FromBase64String($j.os_crypt.encrypted_key); $v=[Security.Cryptography.ProtectedData]::Unprotect($b[5..($b.Length-1)],$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($v))";
  // DPAPI result stays in process memory; never log it or persist plaintext.
  let protectedKey;
  let key = cachedKey;
  if (!key) {
  try { protectedKey = execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script], {encoding:'utf8', windowsHide:true, stdio:['ignore','pipe','pipe']}).trim(); }
  catch { throw new Error('Cannot unlock the current Windows user Mira key'); }
  const encrypted = fs.readFileSync(path.join(process.env.APPDATA, '@mirasim', 'desktop', 'secret-key.enc'));
  if (encrypted.subarray(0,3).toString() !== 'v10') throw new Error('Unsupported safeStorage format');
  const unlock = crypto.createDecipheriv('aes-256-gcm', Buffer.from(protectedKey,'base64'), encrypted.subarray(3,15));
  unlock.setAuthTag(encrypted.subarray(-16));
  const keyHex = Buffer.concat([unlock.update(encrypted.subarray(15,-16)),unlock.final()]).toString('utf8').trim();
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error('Invalid local encryption key');
  key = cachedKey = Buffer.from(keyHex, 'hex');
  }
  function decode(value) {
    if (!value?.startsWith('mrs1:')) return value;
    const b = Buffer.from(value.slice(5), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0,12));
    d.setAuthTag(b.subarray(12,28));
    return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8');
  }
  const token = decode(cfg.auth?.token);
  const pem = decode(cfg.device?.privateKey);
  if (!token || !pem) throw new Error('Sign in to Mira desktop first');
  return {token, exp:cfg.auth.exp, device:native.device(pem), roster:cfg.modelRosterCache};
}
module.exports = {native,loadAuth,build:{version:profile.version,sha256,bundleFile:path.basename(filename)}};
