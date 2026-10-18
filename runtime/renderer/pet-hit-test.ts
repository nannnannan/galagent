/** Cached neutral silhouette. Other expressions keep the same body anchor. */
export class PetHitTest {
 private alpha?: Uint8Array;
 private width=0;
 private height=0;
 mode:'pending'|'alpha'|'rectangle-fallback'='pending';
 cache(image:HTMLImageElement) {
  if(this.mode!=='pending')return;
  try {
   const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
   if(!canvas.width||!canvas.height)throw new Error('image not ready');
   const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('canvas unavailable');
   context.drawImage(image,0,0);const rgba=context.getImageData(0,0,canvas.width,canvas.height).data;
   const alpha=new Uint8Array(canvas.width*canvas.height);for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3];
   this.alpha=alpha;this.width=canvas.width;this.height=canvas.height;this.mode='alpha';
  }catch{this.mode='rectangle-fallback';}
 }
 hit(character:HTMLElement,x:number,y:number):boolean {
  const rect=character.getBoundingClientRect();if(!this.alpha)return x>=rect.left&&x<rect.right&&y>=rect.top&&y<rect.bottom;
  // Individual CSS translate/rotate precede transform; invert them around the
  // actual transform-origin so breathing/sway keep the silhouette aligned.
  const style=getComputedStyle(character),width=parseFloat(style.width)||character.clientWidth,height=parseFloat(style.height)||character.clientHeight;
  const origin=style.transformOrigin.split(' ').map(parseFloat),translate=style.translate.split(' ').map(parseFloat);
  const rotation=parseFloat(style.rotate)||0;
  const transform=new DOMMatrix(style.transform==='none'?undefined:style.transform);
  const matrix=new DOMMatrix().translate(origin[0]||0,origin[1]||0).translate(translate[0]||0,translate[1]||0).rotate(rotation).multiply(transform).translate(-(origin[0]||0),-(origin[1]||0));
  const corners=[[0,0],[width,0],[0,height],[width,height]].map(([px,py])=>matrix.transformPoint({x:px,y:py}));
  const minX=Math.min(...corners.map(p=>p.x)),minY=Math.min(...corners.map(p=>p.y));
  const point=matrix.inverse().transformPoint({x:x-rect.left+minX,y:y-rect.top+minY});
  const scale=Math.min(width/this.width,height/this.height),left=(width-this.width*scale)/2,top=(height-this.height*scale)/2;
  const px=Math.floor((point.x-left)/scale),py=Math.floor((point.y-top)/scale);
  return px>=0&&py>=0&&px<this.width&&py<this.height&&this.alpha[py*this.width+px]>=32;
 }
}
