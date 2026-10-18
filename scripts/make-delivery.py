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
    guide = '''# GalAgent · 星图札记

解压整个 GalAgent 文件夹，双击同目录的 GalAgent.exe。不需要另装 Node 或 Python；请保留 resources 等随包文件。

第一次到「连接」填写自己的 Kimi API 配置，默认地址 https://api.moonshot.cn/v1、模型 kimi-k3。网页或代码工具订阅不自动等于通用 API Key。密钥由 Windows DPAPI 保护并保存在本机。未配置时会明确显示状态，不生成假模型回复。

拖动人物摆放；双击打开对话；人物菜单或托盘可打开界面和退出。关闭对话窗后人物仍保留。Enter 发送、Shift + Enter 换行。

「记忆」可记住、纠正或删除；「札记」与事实分开。纠正保留初遇和历史有效期，删除传播到同源派生记录，旧备份恢复也应用删除账本。「相处」可调整动效、暂停主动互动、导出和恢复存档。

「相处」也显示真实摆放和札记进度。六类相处事件有来源；八小时再见基于已完成聊天，拖动后的模型反应最短间隔20分钟。心情逐渐恢复，关系按事件去重并受日上限控制。隐藏对话窗暂停动画，可见人物保持呼吸和眨眼。

已完成聊天的后台抽取可在同一用户数据目录退出重启后续接，缺失语义向量会补建。失败最多自动尝试三次；达到上限时，重新保存连接配置可重试。普通存档迁移已保存记录，不迁移尚未完成的后台任务。

桌面观察默认关闭，标题采集另行开启。不截屏，不读取键盘内容、剪贴板、浏览器历史或 IM 正文。主动互动需要可靠新鲜观察，并受安静、忙碌、全屏、锁屏和频率预算限制。

用户数据在 %APPDATA%/GalAgent。随包含离线语义检索模型，聊天仍需联网接入 Kimi。不要把不同模型的向量混用。

这是可运行首版；真实 Kimi、连续 48 小时和用户相处仍待验收。详见同目录的 [验收状态](验收状态.md) 与 [后续优化建议](后续优化建议.md)。
'''
    living = release.name == 'living-pet'
    if living:
        guide = guide.replace('第一次到「连接」填写自己的 Kimi API 配置', '人物动作无需配置 API；需要真实聊天时，从菜单到「连接」填写自己的 Kimi API 配置')
        guide = guide.replace('拖动人物摆放；双击打开对话；人物菜单或托盘可打开界面和退出。', '启动只显示透明人物。拖动人物摆放；双击展开贴身短输入，Esc收起；托盘单击显示人物，右键菜单可打开长聊、记忆、连接和退出。')
        guide += '\n动态形体使用现有素材与自有二维网格骨架：头、躯干、发梢、披肩分别运动，含视线、局部眨眼、触摸与拖动惯性。这不是现成Live2D rig；口动是文字演出，没有音频口型同步。安静保留轻微动作，减少动态停止渲染循环。\n'
    output.writestr('GalAgent/使用说明.md', guide)
    for file, name in [
        (root / 'docs/后续优化建议-v1.md', '后续优化建议.md'),
        (root / ('docs/evidence/动态桌宠形体验收.md' if living else 'docs/evidence/首版验收状态.md'), '验收状态.md'),
    ]:
        output.write(file, 'GalAgent/' + name)
    if living:
        for name in ['living-character.gif', 'living-character.webm']:
            output.write(root / 'docs/evidence/living-pet' / name, 'GalAgent/效果演示/' + name)

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
