import type { Expression, GalAgentBridge } from '../shared/contracts';
import {
  ACubismMotion,
  CubismFramework,
  CubismMatrix44,
  CubismShader_WebGL,
  CubismUserModel,
  type CubismIdHandle,
} from './vendor/cubism-framework.js';

const VERT_SETUP_MASK = `attribute vec4 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
varying vec4 v_myPos;
uniform mat4 u_clipMatrix;
void main() {
  gl_Position = u_clipMatrix * a_position;
  v_myPos = u_clipMatrix * a_position;
  v_texCoord = a_texCoord;
  v_texCoord.y = 1.0 - v_texCoord.y;
}`;

const FRAG_SETUP_MASK = `precision mediump float;
varying vec2 v_texCoord;
varying vec4 v_myPos;
uniform vec4 u_baseColor;
uniform vec4 u_channelFlag;
uniform sampler2D s_texture0;
void main() {
  float isInside =
    step(u_baseColor.x, v_myPos.x/v_myPos.w) *
    step(u_baseColor.y, v_myPos.y/v_myPos.w) *
    step(v_myPos.x/v_myPos.w, u_baseColor.z) *
    step(v_myPos.y/v_myPos.w, u_baseColor.w);
  gl_FragColor = u_channelFlag * texture2D(s_texture0, v_texCoord).a * isInside;
}`;

const VERT_NORMAL = `attribute vec4 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
uniform mat4 u_matrix;
void main() {
  gl_Position = u_matrix * a_position;
  v_texCoord = a_texCoord;
  v_texCoord.y = 1.0 - v_texCoord.y;
}`;

const VERT_MASKED = `attribute vec4 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
varying vec4 v_clipPos;
uniform mat4 u_matrix;
uniform mat4 u_clipMatrix;
void main() {
  gl_Position = u_matrix * a_position;
  v_clipPos = u_clipMatrix * a_position;
  v_texCoord = a_texCoord;
  v_texCoord.y = 1.0 - v_texCoord.y;
}`;

const FRAG_PREMULTIPLIED = `precision mediump float;
varying vec2 v_texCoord;
uniform vec4 u_baseColor;
uniform sampler2D s_texture0;
uniform vec4 u_multiplyColor;
uniform vec4 u_screenColor;
void main() {
  vec4 texColor = texture2D(s_texture0, v_texCoord);
  texColor.rgb = texColor.rgb * u_multiplyColor.rgb;
  texColor.rgb = (texColor.rgb + u_screenColor.rgb * texColor.a) - (texColor.rgb * u_screenColor.rgb);
  vec4 color = texColor * u_baseColor;
  gl_FragColor = vec4(color.rgb, color.a);
}`;

const FRAG_MASK_PREMULTIPLIED = `precision mediump float;
varying vec2 v_texCoord;
varying vec4 v_clipPos;
uniform vec4 u_baseColor;
uniform vec4 u_channelFlag;
uniform sampler2D s_texture0;
uniform sampler2D s_texture1;
uniform vec4 u_multiplyColor;
uniform vec4 u_screenColor;
void main() {
  vec4 texColor = texture2D(s_texture0, v_texCoord);
  texColor.rgb = texColor.rgb * u_multiplyColor.rgb;
  texColor.rgb = (texColor.rgb + u_screenColor.rgb * texColor.a) - (texColor.rgb * u_screenColor.rgb);
  vec4 col_formask = texColor * u_baseColor;
  vec4 clipMask = (1.0 - texture2D(s_texture1, v_clipPos.xy / v_clipPos.w)) * u_channelFlag;
  float maskVal = clipMask.r + clipMask.g + clipMask.b + clipMask.a;
  col_formask = col_formask * maskVal;
  gl_FragColor = col_formask;
}`;

const FRAG_MASK_INVERTED_PREMULTIPLIED = `precision mediump float;
varying vec2 v_texCoord;
varying vec4 v_clipPos;
uniform vec4 u_baseColor;
uniform vec4 u_channelFlag;
uniform sampler2D s_texture0;
uniform sampler2D s_texture1;
uniform vec4 u_multiplyColor;
uniform vec4 u_screenColor;
void main() {
  vec4 texColor = texture2D(s_texture0, v_texCoord);
  texColor.rgb = texColor.rgb * u_multiplyColor.rgb;
  texColor.rgb = (texColor.rgb + u_screenColor.rgb * texColor.a) - (texColor.rgb * u_screenColor.rgb);
  vec4 col_formask = texColor * u_baseColor;
  vec4 clipMask = (1.0 - texture2D(s_texture1, v_clipPos.xy / v_clipPos.w)) * u_channelFlag;
  float maskVal = clipMask.r + clipMask.g + clipMask.b + clipMask.a;
  col_formask = col_formask * (1.0 - maskVal);
  gl_FragColor = col_formask;
}`;

const VERT_COPY = `attribute vec4 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_texCoord;
  gl_Position = a_position;
}`;

const FRAG_COPY = `precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D s_texture0;
uniform vec4 u_baseColor;
void main() {
  gl_FragColor = texture2D(s_texture0, v_texCoord) * u_baseColor;
}`;

let shadersPatched = false;
function installInMemoryCubismShaders() {
  if (shadersPatched) return;
  shadersPatched = true;
  (CubismShader_WebGL.prototype as any).generateShaders = function (this: CubismShader_WebGL) {
    if (this._isShaderLoading || this._isShaderLoaded) return;
    this._isShaderLoading = true;
    this._shaderCount = 11;
    this._shaderSets.length = 11;
    for (let i = 0; i < 11; i++) {
      this._shaderSets[i] = {
        shaderProgram: null,
        attributePositionLocation: 0,
        attributeTexCoordLocation: 0,
        samplerTexture0Location: null,
        samplerTexture1Location: null,
        samplerBlendTextureLocation: null,
        samplerFrameBufferTextureLocation: null,
        uniformMatrixLocation: null,
        uniformClipMatrixLocation: null,
        uniformChannelFlagLocation: null,
        uniformBaseColorLocation: null,
        uniformMultiplyColorLocation: null,
        uniformScreenColorLocation: null,
        uniformInvertMaskLocation: null,
      };
    }
    this._vertShaderSrc = VERT_NORMAL;
    this._vertShaderSrcMasked = VERT_MASKED;
    this._vertShaderSrcSetupMask = VERT_SETUP_MASK;
    this._fragShaderSrcSetupMask = FRAG_SETUP_MASK;
    this._fragShaderSrcPremultipliedAlpha = FRAG_PREMULTIPLIED;
    this._fragShaderSrcMaskPremultipliedAlpha = FRAG_MASK_PREMULTIPLIED;
    this._fragShaderSrcMaskInvertedPremultipliedAlpha = FRAG_MASK_INVERTED_PREMULTIPLIED;
    this._vertShaderSrcCopy = VERT_COPY;
    this._fragShaderSrcCopy = FRAG_COPY;
    this.registerShader();
    const copyShaderSet = this._shaderSets[10];
    copyShaderSet.shaderProgram = this.loadShaderProgram(VERT_COPY, FRAG_COPY);
    copyShaderSet.attributeTexCoordLocation = this.gl.getAttribLocation(copyShaderSet.shaderProgram, 'a_texCoord');
    copyShaderSet.attributePositionLocation = this.gl.getAttribLocation(copyShaderSet.shaderProgram, 'a_position');
    copyShaderSet.uniformBaseColorLocation = this.gl.getUniformLocation(copyShaderSet.shaderProgram, 'u_baseColor');
    this._isShaderLoading = false;
    this._isShaderLoaded = true;
  };
}

const ALL_PARAM_NAMES = [
  'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
  'ParamEyeLOpen', 'ParamEyeLSmile', 'ParamEyeROpen', 'ParamEyeRSmile',
  'ParamEyeBallX', 'ParamEyeBallY',
  'ParamBrowLY', 'ParamBrowRY', 'ParamBrowLX', 'ParamBrowRX',
  'ParamBrowLAngle', 'ParamBrowRAngle', 'ParamBrowLForm', 'ParamBrowRForm',
  'ParamMouthForm', 'ParamMouthOpenY', 'ParamCheek',
  'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ',
  'ParamBreath', 'ParamHairFront', 'ParamHairSide', 'ParamHairBack',
] as const;

interface ExpPreset {
  add: Record<string, number>;
  mul: Record<string, number>;
  over: Record<string, number>;
}

const EXPRESSION_PRESETS: Record<string, ExpPreset> = {
  neutral: {
    add: { ParamBrowLY: 0, ParamBrowRY: 0, ParamMouthForm: 0, ParamMouthOpenY: 0 },
    mul: {},
    over: { ParamEyeLSmile: 0, ParamEyeRSmile: 0, ParamCheek: 0 },
  },
  curious: {
    add: { ParamAngleZ: -10, ParamBrowLY: 0.65, ParamBrowRY: 0.65, ParamEyeBallY: 0.25, ParamMouthForm: 0.15 },
    mul: {},
    over: { ParamMouthOpenY: 0.45, ParamCheek: 0.15 },
  },
  pleased: {
    add: { ParamAngleZ: 5, ParamBrowLY: 0.35, ParamBrowRY: 0.35, ParamMouthForm: 0.95 },
    mul: {},
    over: { ParamEyeLOpen: 0, ParamEyeROpen: 0, ParamEyeLSmile: 1, ParamEyeRSmile: 1, ParamMouthOpenY: 0, ParamCheek: 0.65 },
  },
  flustered: {
    add: { ParamAngleY: -8, ParamAngleZ: -6, ParamBrowLY: 0.25, ParamBrowRY: 0.25, ParamBrowLAngle: 0.65, ParamBrowRAngle: 0.65, ParamEyeBallX: -0.4, ParamEyeBallY: -0.25, ParamMouthForm: -0.65 },
    mul: {},
    over: { ParamMouthOpenY: 0.42, ParamCheek: 1.0 },
  },
  annoyed: {
    add: { ParamAngleX: -6, ParamAngleY: -5, ParamBrowLY: -0.55, ParamBrowRY: -0.55, ParamBrowLAngle: -0.8, ParamBrowRAngle: -0.8, ParamMouthForm: -0.9 },
    mul: { ParamEyeLOpen: 0.82, ParamEyeROpen: 0.82 },
    over: { ParamMouthOpenY: 0, ParamCheek: 0.35 },
  },
  softened: {
    add: { ParamAngleZ: 6, ParamBrowLY: 0.2, ParamBrowRY: 0.2, ParamBrowLAngle: 0.35, ParamBrowRAngle: 0.35, ParamMouthForm: 0.7 },
    mul: { ParamEyeLOpen: 0.88, ParamEyeROpen: 0.88 },
    over: { ParamMouthOpenY: 0, ParamCheek: 0.6 },
  },
};

class KimiModelInstance extends CubismUserModel {
  readonly expressions = new Map<string, ACubismMotion>();

  registerExpression(name: string, buf: ArrayBuffer): boolean {
    const motion = this.loadExpression(buf, buf.byteLength, name);
    if (motion) {
      this.expressions.set(name, motion);
      return true;
    }
    return false;
  }

  evaluatePhysicsAndPose(dt: number) {
    if (dt > 0) {
      this._physics?.evaluate(this._model, dt);
      this._pose?.updateParameters(this._model, dt);
    }
  }
}

let coreLoadPromise: Promise<boolean> | null = null;
function ensureCubismCoreLoaded(): Promise<boolean> {
  if ((window as any).Live2DCubismCore?.Moc) return Promise.resolve(true);
  if (coreLoadPromise) return coreLoadPromise;
  coreLoadPromise = new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = new URL('assets/live2d/live2dcubismcore.min.js', document.baseURI).href;
    script.onload = () => resolve(Boolean((window as any).Live2DCubismCore?.Moc));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return coreLoadPromise;
}

function toArrayBuffer(data: Uint8Array | ArrayBuffer): ArrayBuffer {
  const src = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  const copy = new Uint8Array(src.byteLength);
  copy.set(src);
  return copy.buffer;
}

async function readAssetBytes(relPath: string): Promise<ArrayBuffer> {
  const bridge = (window as unknown as { galagent?: GalAgentBridge }).galagent;
  if (typeof bridge?.readLive2DAsset === 'function') {
    const raw = await bridge.readLive2DAsset(relPath);
    return toArrayBuffer(raw);
  }
  const url = new URL(`assets/live2d/${relPath}`, document.baseURI).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch Live2D asset: ${relPath}`);
  return await res.arrayBuffer();
}

export interface KimiLive2DFrameInput {
  dt: number;
  headX: number;
  headY: number;
  headAngle: number;
  bodyX: number;
  bodyY: number;
  breath: number;
  blinkAmount: number;
  mouth: number;
  gazeX: number;
  gazeY: number;
  expression: Expression;
  previous: Expression;
  mix: number;
  intensity: number;
}

export class KimiLive2DRuntime {
  private user?: KimiModelInstance;
  private textures: WebGLTexture[] = [];
  private params = new Map<string, CubismIdHandle>();
  private ready = false;
  private disposed = false;
  private physicsLoaded = false;
  private expressionsLoaded: string[] = [];
  private parameterCount = 0;
  private drawableCount = 0;
  private lastError = '';

  constructor(private gl: WebGLRenderingContext, private onReady?: () => void) {}

  isReady(): boolean {
    return this.ready && !this.disposed && Boolean(this.user);
  }

  getDiagnostics() {
    return {
      live2d: this.isReady(),
      modelName: 'Kimi (kimi.moc3)',
      live2dParameters: this.parameterCount,
      live2dDrawables: this.drawableCount,
      physicsLoaded: this.physicsLoaded,
      expressionsLoaded: [...this.expressionsLoaded],
      ...(this.lastError ? { live2dError: this.lastError } : {}),
    };
  }

  async load(): Promise<boolean> {
    try {
      const bridge = (window as unknown as { galagent?: GalAgentBridge }).galagent;
      const forceLive2D = new URLSearchParams(location.search).get('live2d') === 'on';
      if (typeof bridge?.readLive2DAsset !== 'function' && !forceLive2D) {
        this.lastError = 'bridge.readLive2DAsset unavailable';
        return false;
      }
      const hasCore = await ensureCubismCoreLoaded();
      if (!hasCore || this.disposed) {
        this.lastError = 'Live2DCubismCore failed to load';
        return false;
      }

      installInMemoryCubismShaders();
      if (!CubismFramework.isStarted()) {
        if (!CubismFramework.startUp()) {
          this.lastError = 'CubismFramework.startUp failed';
          return false;
        }
      }
      if (!CubismFramework.isInitialized()) {
        CubismFramework.initialize();
      }

      const modelJsonBuf = await readAssetBytes('kimi/kimi.model3.json');
      const settings = JSON.parse(new TextDecoder().decode(modelJsonBuf));
      const mocBuf = await readAssetBytes(`kimi/${settings.FileReferences.Moc}`);
      if (this.disposed) return false;

      const user = new KimiModelInstance();
      user.loadModel(mocBuf, true);
      const model = user.getModel();
      if (!model) {
        this.lastError = 'user.loadModel failed to create model';
        return false;
      }

      if (settings.FileReferences.Physics) {
        const physBuf = await readAssetBytes(`kimi/${settings.FileReferences.Physics}`);
        user.loadPhysics(physBuf, physBuf.byteLength);
        this.physicsLoaded = true;
      }

      if (Array.isArray(settings.FileReferences.Expressions)) {
        for (const expDef of settings.FileReferences.Expressions) {
          const expBuf = await readAssetBytes(`kimi/${expDef.File}`);
          if (user.registerExpression(expDef.Name, expBuf)) {
            this.expressionsLoaded.push(expDef.Name);
          }
        }
      }

      this.parameterCount = model.getParameterCount();
      this.drawableCount = model.getDrawableCount();
      model.saveParameters();

      for (const name of ALL_PARAM_NAMES) {
        const id = CubismFramework.getIdManager().getId(name);
        if (model.getParameterIndex(id) < this.parameterCount) {
          this.params.set(name, id);
        }
      }

      const mat = user.getModelMatrix();
      mat.setHeight(2.0);
      mat.setPosition(0, 0);

      user.createRenderer(this.gl.drawingBufferWidth || 360, this.gl.drawingBufferHeight || 620);
      const renderer = user.getRenderer();
      renderer.startUp(this.gl);
      renderer.setIsPremultipliedAlpha(true);

      const texFiles: string[] = settings.FileReferences.Textures || ['kimi.2048/texture_00.png'];
      for (const [index, file] of texFiles.entries()) {
        const img = new Image();
        img.src = new URL(`assets/live2d/kimi/${file}`, document.baseURI).href;
        await img.decode();
        if (this.disposed) return false;
        const texture = this.gl.createTexture();
        if (!texture) {
          this.lastError = 'gl.createTexture failed';
          return false;
        }
        this.textures.push(texture);
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
        this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, img);
        const isPow2 = (v: number) => (v & (v - 1)) === 0;
        if (isPow2(img.width) && isPow2(img.height)) {
          this.gl.generateMipmap(this.gl.TEXTURE_2D);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR_MIPMAP_LINEAR);
        } else {
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        }
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        renderer.bindTexture(index, texture);
      }

      this.user = user;
      this.ready = true;
      this.lastError = '';
      this.onReady?.();
      return true;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  private setParam(name: string, value: number) {
    const id = this.params.get(name);
    if (id && this.user) {
      this.user.getModel().setParameterValueById(id, value);
    }
  }

  render(width: number, height: number, input: KimiLive2DFrameInput) {
    if (!this.user || !this.ready || this.disposed) return;
    const model = this.user.getModel();
    model.loadParameters();

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    let angleX = clamp((input.headX / 12) * 20, -30, 30);
    let angleY = clamp((-input.headY / 4) * 14, -30, 30);
    let angleZ = clamp((input.headAngle / 0.11) * 16, -30, 30);
    const bodyX = clamp((input.bodyX / 9) * 8, -10, 10);
    const bodyY = clamp((-input.bodyY / 8) * 6, -10, 10);
    let eyeBallX = clamp(input.gazeX, -1, 1);
    let eyeBallY = clamp(-input.gazeY, -1, 1);
    let eyeLOpen = 1 - clamp(input.blinkAmount, 0, 1);
    let eyeROpen = 1 - clamp(input.blinkAmount, 0, 1);
    let eyeLSmile = 0;
    let eyeRSmile = 0;
    let browLY = 0;
    let browRY = 0;
    let browLAngle = 0;
    let browRAngle = 0;
    let mouthForm = 0;
    let mouthOpenY = 0;
    let cheek = 0;

    const prevPreset = EXPRESSION_PRESETS[input.previous] || EXPRESSION_PRESETS.neutral;
    const currPreset = EXPRESSION_PRESETS[input.expression] || EXPRESSION_PRESETS.neutral;
    const mix = clamp(input.mix, 0, 1);
    const intensity = clamp(input.intensity, 0, 1);

    const addVal = (key: string) => lerp(prevPreset.add[key] ?? 0, currPreset.add[key] ?? 0, mix) * intensity;
    const mulVal = (key: string) => lerp(1, lerp(prevPreset.mul[key] ?? 1, currPreset.mul[key] ?? 1, mix), intensity);
    const overVal = (key: string, base: number) => {
      const hasPrev = key in prevPreset.over;
      const hasCurr = key in currPreset.over;
      if (!hasPrev && !hasCurr) return base;
      const target = lerp(hasPrev ? prevPreset.over[key] : base, hasCurr ? currPreset.over[key] : base, mix);
      return lerp(base, target, intensity);
    };

    angleX = clamp(angleX + addVal('ParamAngleX'), -30, 30);
    angleY = clamp(angleY + addVal('ParamAngleY'), -30, 30);
    angleZ = clamp(angleZ + addVal('ParamAngleZ'), -30, 30);
    eyeBallX = clamp(eyeBallX + addVal('ParamEyeBallX'), -1, 1);
    eyeBallY = clamp(eyeBallY + addVal('ParamEyeBallY'), -1, 1);
    browLY = clamp(browLY + addVal('ParamBrowLY'), -1, 1);
    browRY = clamp(browRY + addVal('ParamBrowRY'), -1, 1);
    browLAngle = clamp(browLAngle + addVal('ParamBrowLAngle'), -1, 1);
    browRAngle = clamp(browRAngle + addVal('ParamBrowRAngle'), -1, 1);
    mouthForm = clamp(mouthForm + addVal('ParamMouthForm'), -1, 1);

    eyeLOpen = clamp(overVal('ParamEyeLOpen', eyeLOpen * mulVal('ParamEyeLOpen')), 0, 1);
    eyeROpen = clamp(overVal('ParamEyeROpen', eyeROpen * mulVal('ParamEyeROpen')), 0, 1);
    eyeLSmile = clamp(overVal('ParamEyeLSmile', eyeLSmile), 0, 1);
    eyeRSmile = clamp(overVal('ParamEyeRSmile', eyeRSmile), 0, 1);
    cheek = clamp(overVal('ParamCheek', cheek), 0, 1);
    mouthOpenY = clamp(overVal('ParamMouthOpenY', mouthOpenY + addVal('ParamMouthOpenY')), 0, 1);

    if (input.mouth > 0.05) {
      mouthOpenY = clamp(input.mouth, 0, 1);
    }

    this.setParam('ParamAngleX', angleX);
    this.setParam('ParamAngleY', angleY);
    this.setParam('ParamAngleZ', angleZ);
    this.setParam('ParamBodyAngleX', bodyX);
    this.setParam('ParamBodyAngleY', bodyY);
    this.setParam('ParamBodyAngleZ', bodyX * 0.35);
    this.setParam('ParamEyeBallX', eyeBallX);
    this.setParam('ParamEyeBallY', eyeBallY);
    this.setParam('ParamEyeLOpen', eyeLOpen);
    this.setParam('ParamEyeROpen', eyeROpen);
    this.setParam('ParamEyeLSmile', eyeLSmile);
    this.setParam('ParamEyeRSmile', eyeRSmile);
    this.setParam('ParamBrowLY', browLY);
    this.setParam('ParamBrowRY', browRY);
    this.setParam('ParamBrowLAngle', browLAngle);
    this.setParam('ParamBrowRAngle', browRAngle);
    this.setParam('ParamMouthForm', mouthForm);
    this.setParam('ParamMouthOpenY', mouthOpenY);
    this.setParam('ParamCheek', cheek);
    this.setParam('ParamBreath', clamp((input.breath + 1) * 0.5, 0, 1));

    this.user.evaluatePhysicsAndPose(input.dt);
    model.update();

    this.user.setRenderTargetSize(width, height);
    const scale = Math.min(width / 1024, height / 1536);
    const wRatio = (1024 * scale) / Math.max(1, width);
    const hRatio = (1536 * scale) / Math.max(1, height);

    const matrix = new CubismMatrix44();
    matrix.scale(wRatio * 1.5, hRatio);
    if (input.bodyY) {
      matrix.translateRelative(0, clamp((-input.bodyY / 768) * 1.4, -0.06, 0.06));
    }
    matrix.multiplyByMatrix(this.user.getModelMatrix());

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null);
    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, null);
    const renderer = this.user.getRenderer();
    renderer.setMvpMatrix(matrix);
    renderer.setRenderState(null as unknown as WebGLFramebuffer, [0, 0, width, height]);
    renderer.drawModel('');
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    for (const tex of this.textures) {
      this.gl.deleteTexture(tex);
    }
    this.textures = [];
    this.user?.release();
    this.user = undefined;
  }
}
