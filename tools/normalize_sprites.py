#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""精灵图归一化：让所有帧在渲染时尺寸稳定、脚底对齐。

为什么需要：渲染端锁定显示高度、宽度自适应（renderer.js setScale），
各帧画布比例/角色占比不一致时，行走换帧会肉眼可见地跳变（0.5.x 实测
宽度在 ~104px 与 ~154px 间抖动）。本脚本统一为：
  1) 按 alpha 通道裁掉透明边；
  2) 角色缩放到统一像素高度（CHAR_H，与最老的 340px 原画一致，保锐度）；
  3) 底部中心对齐贴到统一画布（同一画布 => 渲染宽度恒定）；
  4) PNG optimize 重压缩（AI 大图 1.2MB -> 约百 KB）。

主人换装工作流不变：生成新帧覆盖 sprites/walk-a|walk-b.png 后，
  python tools/normalize_sprites.py
再重载扩展即可。只处理 IN_USE 里列出的在用帧。
"""
from pathlib import Path
from PIL import Image

SPRITES = Path(__file__).resolve().parents[1] / 'sprites'
CHAR_H = 340          # 角色统一像素高（对齐最早原画的 340）
PAD_X = 12            # 画布左右留白
PAD_TOP = 10          # 顶部留白（呼吸空间，徽章定位在 root 不受影响）
PAD_BOTTOM = 8        # 底部留白（脚不贴死画布边）
IN_USE = ['front.png', 'back.png', 'side.png', 'walk-a.png', 'walk-b.png']


def trim(im: Image.Image) -> Image.Image:
    bbox = im.getchannel('A').getbbox()
    return im.crop(bbox) if bbox else im


def main():
    trimmed = {}
    for name in IN_USE:
        p = SPRITES / name
        im = Image.open(p).convert('RGBA')
        t = trim(im)
        scale = CHAR_H / t.height
        t = t.resize((max(1, round(t.width * scale)), CHAR_H), Image.LANCZOS)
        trimmed[name] = t
        print(f'{name}: {im.width}x{im.height} -> char {t.width}x{t.height}')

    canvas_w = max(t.width for t in trimmed.values()) + PAD_X * 2
    canvas_h = CHAR_H + PAD_TOP + PAD_BOTTOM
    print(f'canvas = {canvas_w}x{canvas_h}')

    for name, t in trimmed.items():
        canvas = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))
        x = (canvas_w - t.width) // 2
        y = canvas_h - PAD_BOTTOM - t.height
        canvas.paste(t, (x, y))
        out = SPRITES / name
        before = out.stat().st_size
        canvas.save(out, optimize=True)
        print(f'{name}: canvas {canvas_w}x{canvas_h}, '
              f'{before // 1024}KB -> {out.stat().st_size // 1024}KB')


if __name__ == '__main__':
    main()

（0.5.3 起精灵图统一 ASCII 文件名：front/back/side/walk-a/walk-b，
 根治中文文件名在 web_accessible_resources 的百分号编码隐患。）
