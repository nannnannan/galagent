export type CubismIdHandle = unknown;

export interface CubismModel {
  loadParameters(): void;
  saveParameters(): void;
  update(): void;
  getParameterCount(): number;
  getDrawableCount(): number;
  getParameterIndex(id: CubismIdHandle): number;
  getParameterValueById(id: CubismIdHandle): number;
  setParameterValueById(id: CubismIdHandle, value: number, weight?: number): void;
  addParameterValueById(id: CubismIdHandle, value: number, weight?: number): void;
  multiplyParameterValueById(id: CubismIdHandle, value: number, weight?: number): void;
  getCanvasWidth(): number;
  getCanvasHeight(): number;
}

export interface CubismModelMatrix {
  setWidth(w: number): void;
  setHeight(h: number): void;
  setPosition(x: number, y: number): void;
  centerX(x: number): void;
  centerY(y: number): void;
  getArray(): Float32Array;
}

export declare class CubismMatrix44 {
  constructor();
  loadIdentity(): void;
  scale(x: number, y: number): void;
  translateRelative(x: number, y: number): void;
  multiplyByMatrix(m: CubismMatrix44 | CubismModelMatrix): void;
  getArray(): Float32Array;
}

export interface CubismRenderer_WebGL {
  startUp(gl: WebGLRenderingContext): void;
  setIsPremultipliedAlpha(enable: boolean): void;
  loadShaders(path: string): void;
  bindTexture(modelTextureAssign: number, glTextureNumber: WebGLTexture): void;
  setMvpMatrix(matrix: CubismMatrix44): void;
  setRenderState(fbo: WebGLFramebuffer, viewport: number[]): void;
  drawModel(shaderPath?: string): void;
}

export declare class ACubismMotion {}

export declare class CubismUserModel {
  protected _model: CubismModel;
  protected _expressionManager: {
    startMotion(motion: ACubismMotion, autoDelete: boolean): unknown;
    updateMotion(model: CubismModel, deltaTimeSeconds: number): boolean;
  } | null;
  protected _physics: {
    evaluate(model: CubismModel, deltaTimeSeconds: number): void;
  } | null;
  protected _pose: {
    updateParameters(model: CubismModel, deltaTimeSeconds: number): void;
  } | null;
  constructor();
  loadModel(buffer: ArrayBuffer, shouldCheckMocConsistency?: boolean): void;
  loadPose(buffer: ArrayBuffer, size: number): void;
  loadPhysics(buffer: ArrayBuffer, size: number): void;
  loadExpression(buffer: ArrayBuffer, size: number, name: string): ACubismMotion | null;
  getModel(): CubismModel;
  getModelMatrix(): CubismModelMatrix;
  createRenderer(width?: number, height?: number): void;
  getRenderer(): CubismRenderer_WebGL;
  setRenderTargetSize(width: number, height: number): void;
  release(): void;
}

export declare class CubismFramework {
  static startUp(option?: unknown): boolean;
  static initialize(): void;
  static dispose(): void;
  static isStarted(): boolean;
  static isInitialized(): boolean;
  static getIdManager(): {
    getId(name: string): CubismIdHandle;
  };
}

export declare class CubismShader_WebGL {
  gl: WebGLRenderingContext;
  _shaderSets: any[];
  _shaderCount: number;
  _isShaderLoading: boolean;
  _isShaderLoaded: boolean;
  _vertShaderSrc: string;
  _vertShaderSrcMasked: string;
  _vertShaderSrcSetupMask: string;
  _fragShaderSrcSetupMask: string;
  _fragShaderSrcPremultipliedAlpha: string;
  _fragShaderSrcMaskPremultipliedAlpha: string;
  _fragShaderSrcMaskInvertedPremultipliedAlpha: string;
  _vertShaderSrcCopy: string;
  _fragShaderSrcCopy: string;
  registerShader(): void;
  loadShaderProgram(vertShaderSrc: string, fragShaderSrc: string): WebGLProgram;
}
