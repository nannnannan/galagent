"""Create and verify the portable Windows delivery from the current build."""
from pathlib import Path
import hashlib
import json
import zipfile
import argparse
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--release', default='release', help='Project-relative packaged output directory')
args = parser.parse_args()
release = (root / args.release).resolve()
if not release.is_relative_to(root / 'release'):
    raise ValueError('Delivery output must stay inside this project release directory')
source = release / 'win-unpacked'
archive = release / 'GalAgent-0.1.0-windows-x64.zip'

def sha256(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

assert (source / 'GalAgent.exe').is_file()
assert (source / 'resources/models/onnx/model_quantized.onnx').is_file()
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as output:
    for file in sorted(source.rglob('*')):
        if file.is_file():
            output.write(file, 'GalAgent/' + file.relative_to(source).as_posix())
    guide = '''# GalAgent

解压整个 GalAgent 文件夹，双击同目录的 GalAgent.exe。不需要另装 Node 或 Python；请保留 resources 等随包文件。

1. 右键桌面小人 → 打开聊天 → 「连接」：填入任意 OpenAI 兼容接口的地址、模型和 API Key（密钥由 Windows DPAPI 加密保存在本机）。未配置时不会生成假回复。
2. 「角色」：选择内置角色卡或自己写一张；「小人」：挑选像素小人，或导入自制小人（制作方法见 resources/skills/galagent-pixel-pet/SKILL.md）。
3. 「陪伴」：主动开口的间隔、上限、心跳、免打扰时段等都可以自己设；「定时」：查看和设置提醒，也可以在聊天里说“半小时后提醒我…”。
4. 「隐私与沙箱」：执行器默认只能在工作目录内读写、不能运行 Shell；发往外部的内容会自动隐藏密钥与敏感词。桌面观察默认关闭。

拖动小人摆放；双击小人展开输入框，Esc 收起；托盘图标右键可切换角色、一键隐私锁定和退出。

用户数据在 %APPDATA%/GalAgent，自定义小人在 %APPDATA%/GalAgent/pets。详见同目录的 [后续优化建议](后续优化建议.md)。
'''
    output.writestr('GalAgent/使用说明.md', guide)
    output.write(root / 'docs/后续优化建议-v1.md', 'GalAgent/后续优化建议.md')

with zipfile.ZipFile(archive) as result:
    assert result.testzip() is None
    entries = result.namelist()
    assert len(entries) == len(set(entries)), 'Archive contains duplicate paths'
    assert 'GalAgent/GalAgent.exe' in entries
    assert 'GalAgent/resources/models/onnx/model_quantized.onnx' in entries
    for member, file in [
        ('GalAgent/GalAgent.exe', source / 'GalAgent.exe'),
        ('GalAgent/resources/app.asar', source / 'resources/app.asar'),
    ]:
        assert hashlib.sha256(result.read(member)).hexdigest() == sha256(file)

manifest = {
    'builtAt': datetime.now(timezone.utc).isoformat(),
    'archive': archive.name,
    'source': source.relative_to(root).as_posix(),
    'bytes': archive.stat().st_size,
    'sha256': sha256(archive),
    'entries': len(entries),
    'integrity': True,
    'exe_sha256': sha256(source / 'GalAgent.exe'),
    'asar_sha256': sha256(source / 'resources/app.asar'),
    'acceptance': 'Runnable development version; local scene/persona-state checks passed; real Kimi, physical lifecycle, resource targets, 48h soak and user experience pending',
}
(release / 'delivery-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps(manifest, indent=2))
