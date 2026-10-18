import {CubismFramework} from './vendor/CubismSdkForWeb-5-r.5/Framework/src/live2dcubismframework';
import {CubismUserModel} from './vendor/CubismSdkForWeb-5-r.5/Framework/src/model/cubismusermodel';
import {CubismMatrix44} from './vendor/CubismSdkForWeb-5-r.5/Framework/src/math/cubismmatrix44';
import {ACubismMotion} from './vendor/CubismSdkForWeb-5-r.5/Framework/src/motion/acubismmotion';

const canvas = document.querySelector<HTMLCanvasElement>('#model')!;
const status = document.querySelector<HTMLElement>('#status')!;
const fallback = document.querySelector<HTMLElement>('#fallback')!;
const sdk = '/vendor/CubismSdkForWeb-5-r.5';
const modelRoot = '/assets/kimi/';
const gl = canvas.getContext('webgl', {alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true});

const state = {
  ready: false,
  frames: 0,
  active: true,
  disposed: false,
  pose: 'auto',
  expression: 'neutral',
  zoom: 'bust' as 'closeup' | 'bust' | 'full',
  poseLoaded: false,
  physicsLoaded: false,
  expressionsLoaded: [] as string[],
  coreVersion: 0,
  parameters: 0,
  drawables: 0,
  transparentPixels: 0,
  coloredPixels: 0,
  error: '',
  renderer: '',
  modelName: 'Kimi (kimi.moc3)'
};

class KimiLive2DModel extends CubismUserModel {
  private expressions = new Map<string, ACubismMotion>();

  registerExpression(name: string, buf: ArrayBuffer) {
    const motion = this.loadExpression(buf, buf.byteLength, name);
    if (motion) {
      this.expressions.set(name, motion);
      state.expressionsLoaded.push(name);
    }
  }

  applyExpression(name: string): boolean {
    const motion = this.expressions.get(name);
    if (!motion || !this._expressionManager) return false;
    this._expressionManager.startMotion(motion, false);
    state.expression = name;
    return true;
  }

  advance(dt: number) {
    this._expressionManager?.updateMotion(this._model, dt);
    this._physics?.evaluate(this._model, dt);
    this._pose?.updateParameters(this._model, dt);
  }
}

let user: KimiLive2DModel | undefined;
let raf = 0, last = 0, time = 0, hidden = false, paused = false;
let pointerX = 0, pointerY = 0, pointerActive = false;
const textures: WebGLTexture[] = [];
const params = new Map<string, any>();

const ALL_PARAM_NAMES = [
  'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
  'ParamEyeLOpen', 'ParamEyeLSmile', 'ParamEyeROpen', 'ParamEyeRSmile',
  'ParamEyeBallX', 'ParamEyeBallY',
  'ParamBrowLY', 'ParamBrowRY', 'ParamBrowLX', 'ParamBrowRX',
  'ParamBrowLAngle', 'ParamBrowRAngle', 'ParamBrowLForm', 'ParamBrowRForm',
  'ParamMouthForm', 'ParamMouthOpenY', 'ParamCheek',
  'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ',
  'ParamBreath', 'ParamHairFront', 'ParamHairSide', 'ParamHairBack'
];

function fail(error: unknown) {
  state.error = String(error);
  fallback.hidden = false;
  fallback.textContent = '模型加载失败：' + state.error;
  status.textContent = '验证失败；正式桌宠不受影响';
  cancelAnimationFrame(raf);
}

function visible(active: boolean) {
  hidden = !active;
  state.active = !hidden && !paused && !state.disposed;
  cancelAnimationFrame(raf);
  last = 0;
  if (state.ready && state.active) raf = requestAnimationFrame(frame);
}

function dispose() {
  if (state.disposed) return;
  cancelAnimationFrame(raf);
  state.active = false;
  state.disposed = true;
  user?.release();
  textures.forEach(t => gl?.deleteTexture(t));
  CubismFramework.dispose();
  window.removeEventListener('resize', resize);
}

function resize() {
  const dpr = Math.min(Math.max(devicePixelRatio || 1, 2.0), 3.0);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  user?.setRenderTargetSize(canvas.width, canvas.height);
}

function applyZoom(zoom: 'closeup' | 'bust' | 'full') {
  state.zoom = zoom;
  if (!user) return;
  const mat = user.getModelMatrix();
  if (zoom === 'full') {
    mat.setHeight(1.82);
    mat.setPosition(0, -0.02);
  } else if (zoom === 'closeup') {
    mat.setHeight(5.2);
    mat.setPosition(0, -1.76);
  } else {
    // Bust/upper-body framing centering Kimi's face & upper torso in the window
    mat.setHeight(3.95);
    mat.setPosition(0, -1.20);
  }
  document.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach(b => {
    b.classList.toggle('active', b.dataset.zoom === zoom);
  });
}

function set(name: string, value: number) {
  const id = params.get(name);
  if (id && user) user.getModel().setParameterValueById(id, value);
}

function pixels() {
  if (!gl) return;
  const data = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  let clear = 0, paint = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] === 0) clear++;
    if (data[i] > 10) paint++;
  }
  state.transparentPixels = clear;
  state.coloredPixels = paint;
  return {clear, paint, total: canvas.width * canvas.height};
}

function draw() {
  if (!gl || !user) return;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const matrix = new CubismMatrix44();
  matrix.scale(canvas.height / canvas.width, 1);
  matrix.multiplyByMatrix(user.getModelMatrix());
  const renderer = user.getRenderer();
  renderer.setMvpMatrix(matrix);
  renderer.setRenderState(null as any, [0, 0, canvas.width, canvas.height]);
  renderer.drawModel(sdk + '/Framework/Shaders/WebGL/');
}

function syncActiveButtons() {
  document.querySelectorAll<HTMLButtonElement>('[data-pose]').forEach(b => {
    b.classList.toggle('active', b.dataset.pose === state.pose);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-exp]').forEach(b => {
    b.classList.toggle('active', b.dataset.exp === state.expression);
  });
}

function frame(now: number) {
  if (!state.active || state.disposed) return;
  try {
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
    last = now;
    time += dt;
    const model = user!.getModel();
    model.loadParameters();

    const gazeX = pointerActive ? pointerX : Math.sin(time * 0.9) * 0.45;
    const gazeY = pointerActive ? pointerY : Math.sin(time * 0.6) * 0.25;

    if (state.pose === 'left') {
      set('ParamAngleX', -22);
      set('ParamAngleY', 0);
      set('ParamAngleZ', -4);
      set('ParamBodyAngleX', -6);
      set('ParamEyeBallX', -0.75);
      set('ParamEyeBallY', 0);
    } else if (state.pose === 'right') {
      set('ParamAngleX', 22);
      set('ParamAngleY', 0);
      set('ParamAngleZ', 4);
      set('ParamBodyAngleX', 6);
      set('ParamEyeBallX', 0.75);
      set('ParamEyeBallY', 0);
    } else if (state.pose === 'auto') {
      set('ParamAngleX', gazeX * 18);
      set('ParamAngleY', gazeY * 10);
      set('ParamAngleZ', Math.sin(time * 0.7) * 5);
      set('ParamBodyAngleX', Math.sin(time * 0.8) * 4.5 + gazeX * 4);
      set('ParamEyeBallX', gazeX);
      set('ParamEyeBallY', gazeY);
    } else {
      set('ParamAngleX', 0);
      set('ParamAngleY', 0);
      set('ParamAngleZ', 0);
      set('ParamBodyAngleX', 0);
      set('ParamEyeBallX', 0);
      set('ParamEyeBallY', 0);
    }

    const autoBlink = state.pose === 'auto' && (time % 4.2 > 0 && time % 4.2 < 0.15);
    const eyeOpen = state.pose === 'blink' ? 0 : autoBlink ? 0 : 1;
    set('ParamEyeLOpen', eyeOpen);
    set('ParamEyeROpen', eyeOpen);
    set('ParamEyeLSmile', state.pose === 'smile' ? 1 : 0);
    set('ParamEyeRSmile', state.pose === 'smile' ? 1 : 0);

    if (state.pose === 'smile') {
      set('ParamMouthForm', 1);
      set('ParamMouthOpenY', 0.45);
    } else if (state.pose === 'talk') {
      set('ParamMouthForm', 0.35);
      set('ParamMouthOpenY', (Math.sin(time * 11) + 1) * 0.45);
    } else {
      set('ParamMouthForm', 0);
      set('ParamMouthOpenY', 0);
    }

    set('ParamBrowLY', 0);
    set('ParamBrowRY', 0);
    set('ParamBrowLAngle', 0);
    set('ParamBrowRAngle', 0);
    set('ParamCheek', 0);
    set('ParamBreath', (Math.sin(time * 1.8) + 1) / 2);

    // Evaluate active expression, pendulum physics, and pose
    user!.advance(dt);

    // If explicitly testing blink or left/right pose via probe, ensure exact target values
    if (state.pose === 'blink') {
      set('ParamEyeLOpen', 0);
      set('ParamEyeROpen', 0);
    } else if (state.pose === 'left') {
      set('ParamAngleX', -22);
    } else if (state.pose === 'right') {
      set('ParamAngleX', 22);
    }

    model.update();
    draw();
    state.frames++;
    if (state.frames % 20 === 0) {
      status.textContent = `Kimi 真模型已加载 · ${state.parameters}参数 · ${state.drawables}部件 · 姿态:${state.pose} · 表情:${state.expression}`;
    }
    raf = requestAnimationFrame(frame);
  } catch (error) {
    fail(error);
  }
}

async function main() {
  if (!gl) throw Error('WebGL不可用');
  resize();
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  state.renderer = extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  const core = (window as any).Live2DCubismCore;
  state.coreVersion = core.Version.csmGetVersion();
  if (!CubismFramework.startUp()) throw Error('Cubism启动失败');
  CubismFramework.initialize();

  const settings = await fetch(modelRoot + 'kimi.model3.json').then(r => {
    if (!r.ok) throw Error('模型清单读取失败');
    return r.json();
  });
  const bytes = await fetch(modelRoot + settings.FileReferences.Moc).then(r => {
    if (!r.ok) throw Error('moc3读取失败');
    return r.arrayBuffer();
  });

  user = new KimiLive2DModel();
  user.loadModel(bytes, true);
  const model = user.getModel();
  if (!model) throw Error('moc3未创建模型');

  for (const kind of ['Pose', 'Physics'] as const) {
    const file = settings.FileReferences[kind];
    if (file) {
      const data = await fetch(modelRoot + file).then(r => {
        if (!r.ok) throw Error(kind + '读取失败');
        return r.arrayBuffer();
      });
      if (kind === 'Pose') {
        user.loadPose(data, data.byteLength);
        state.poseLoaded = true;
      } else {
        user.loadPhysics(data, data.byteLength);
        state.physicsLoaded = true;
      }
    }
  }

  if (Array.isArray(settings.FileReferences.Expressions)) {
    for (const expDef of settings.FileReferences.Expressions) {
      const buf = await fetch(modelRoot + expDef.File).then(r => {
        if (!r.ok) throw Error('Expression读取失败: ' + expDef.Name);
        return r.arrayBuffer();
      });
      user.registerExpression(expDef.Name, buf);
    }
  }

  state.parameters = model.getParameterCount();
  state.drawables = model.getDrawableCount();
  model.saveParameters();

  for (const name of ALL_PARAM_NAMES) {
    const id = CubismFramework.getIdManager().getId(name);
    if (model.getParameterIndex(id) < state.parameters) params.set(name, id);
  }

  applyZoom(state.zoom);
  user.applyExpression('neutral');

  user.createRenderer(canvas.width, canvas.height);
  const renderer = user.getRenderer();
  renderer.startUp(gl);
  renderer.setIsPremultipliedAlpha(true);
  renderer.loadShaders(sdk + '/Framework/Shaders/WebGL/');

  for (const [index, file] of settings.FileReferences.Textures.entries()) {
    const img = new Image();
    img.src = modelRoot + file;
    await img.decode();
    const texture = gl.createTexture();
    if (!texture) throw Error('纹理创建失败');
    textures.push(texture);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    const isPow2 = (v: number) => (v & (v - 1)) === 0;
    if (isPow2(img.width) && isPow2(img.height)) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      const aniso = gl.getExtension('EXT_texture_filter_anisotropic') ||
        gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
        gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
      if (aniso) {
        const maxAniso = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 4;
        gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(maxAniso, 8));
      }
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    renderer.bindTexture(index, texture);
  }

  state.ready = true;
  visible(!hidden);
}

(window as any).live2dProbe = {
  state,
  pixels,
  setPose: (pose: string) => {
    state.pose = pose;
    syncActiveButtons();
  },
  setExpression: (name: string) => {
    const ok = user?.applyExpression(name) ?? false;
    syncActiveButtons();
    return ok;
  },
  setZoom: (zoom: 'closeup' | 'bust' | 'full') => {
    applyZoom(zoom);
  },
  setActive: visible,
  dispose,
  readPart: (name: string) => user?.getModel().getPartOpacityById(CubismFramework.getIdManager().getId(name)),
  readParam: (name: string) => params.has(name) ? user?.getModel().getParameterValueById(params.get(name)) : null
};

document.querySelectorAll<HTMLButtonElement>('[data-pose]').forEach(b => {
  b.onclick = () => {
    state.pose = b.dataset.pose!;
    syncActiveButtons();
  };
});

document.querySelectorAll<HTMLButtonElement>('[data-exp]').forEach(b => {
  b.onclick = () => {
    user?.applyExpression(b.dataset.exp!);
    syncActiveButtons();
  };
});

document.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach(b => {
  b.onclick = () => {
    applyZoom((b.dataset.zoom as 'closeup' | 'bust' | 'full') || 'bust');
  };
});

const fsBtn = document.querySelector<HTMLButtonElement>('#fullscreen');
if (fsBtn) {
  fsBtn.onclick = async () => {
    const isFs = await (window as any).probeHost?.toggleFullscreen?.();
    fsBtn.textContent = isFs ? '退出全屏' : '全屏';
    fsBtn.classList.toggle('active', !!isFs);
  };
}

document.querySelector<HTMLButtonElement>('#pause')!.onclick = e => {
  paused = !paused;
  (e.currentTarget as HTMLButtonElement).textContent = paused ? '继续' : '暂停';
  visible(!hidden);
};

document.querySelector<HTMLButtonElement>('#close')!.onclick = () => window.close();

canvas.addEventListener('pointermove', e => {
  const rect = canvas.getBoundingClientRect();
  pointerX = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
  pointerY = Math.max(-1, Math.min(1, 1 - ((e.clientY - rect.top) / rect.height) * 2));
  pointerActive = true;
});
canvas.addEventListener('pointerleave', () => {
  pointerActive = false;
});

(window as any).probeHost?.onVisibility(visible);
window.addEventListener('resize', resize);
window.addEventListener('pagehide', dispose);
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  cancelAnimationFrame(raf);
  state.active = false;
  fail('WebGL上下文已丢失；请关闭并重开样例');
});

main().catch(fail);
