import { lookup } from 'node:dns/promises';
// Which addresses count as local / private network. Shared by the executor's FetchURL, the web tools and the WeChat client.
import { isIP } from 'node:net';
/** Eight 16-bit groups of an IPv6 address (handles '::' and a dotted IPv4 tail); undefined if malformed. */
function ipv6Groups(v:string):number[]|undefined{
 let text=v;
 const dotted=text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
 if(dotted){const o=dotted[2].split('.').map(Number);text=dotted[1]+((o[0]<<8)|o[1]).toString(16)+':'+((o[2]<<8)|o[3]).toString(16);}
 const halves=text.split('::');if(halves.length>2)return undefined;
 const part=(x:string)=>x?x.split(':'):[];
 const head=part(halves[0]),tail=halves.length===2?part(halves[1]):[];
 const fill=halves.length===2?8-head.length-tail.length:0;
 if(fill<0||(halves.length===1&&head.length!==8))return undefined;
 const groups=[...head,...Array(fill).fill('0'),...tail].map(g=>/^[0-9a-f]{1,4}$/.test(g)?parseInt(g,16):NaN);
 return groups.length===8&&groups.every(Number.isFinite)?groups:undefined;
}
const ipv4Of=(hi:number,lo:number)=>`${hi>>8}.${hi&255}.${lo>>8}.${lo&255}`;
export function isPrivateAddress(address:string):boolean{
 const v=address.toLowerCase().replace(/^\[|\]$/g,'');
 if(isIP(v)===4){const [a,b]=v.split('.').map(Number);return a===0||a===10||a===127||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===198&&(b===18||b===19))||a>=224;}
 if(isIP(v)!==6)return true;
 const g=ipv6Groups(v);if(!g)return true;
 const zero=(from:number,to:number)=>g.slice(from,to).every(x=>x===0);
 if(zero(0,8))return true;                                   // ::
 if(zero(0,7)&&g[7]===1)return true;                         // ::1
 if(zero(0,5)&&(g[5]===0xffff||g[5]===0))return isPrivateAddress(ipv4Of(g[6],g[7]));   // ::ffff:a.b.c.d and ::a.b.c.d
 // Translation prefixes carry an IPv4 address inside: judge that address, so DNS64 / 6to4 sites stay reachable.
 if(g[0]===0x64&&g[1]===0xff9b&&(zero(2,6)||g[2]===1))return isPrivateAddress(ipv4Of(g[6],g[7]));  // NAT64 64:ff9b::/96, 64:ff9b:1::/48
 if(g[0]===0x2002)return isPrivateAddress(ipv4Of(g[1],g[2]));                                   // 6to4
 if(g[0]===0x2001&&g[1]===0)return isPrivateAddress(ipv4Of(g[6]^0xffff,g[7]^0xffff));           // Teredo client (obfuscated)
 if(g[0]===0x2001&&g[1]===0xdb8)return true;                // documentation
 if(g[0]===0x100&&zero(1,4))return true;                     // discard-only 100::/64
 return (g[0]&0xfe00)===0xfc00||(g[0]&0xffc0)===0xfe80||(g[0]&0xff00)===0xff00;   // ULA, link-local, multicast
}

// FetchURL must not let a prompt-injected model reach loopback, LAN or link-local services (local proxies, router pages, metadata endpoints).
export async function assertPublicUrl(url:URL){
 const host=url.hostname.replace(/^\[|\]$/g,'');
 if(!host||/^localhost$/i.test(host)||/\.localhost$/i.test(host))throw new Error('FetchURL blocks local and private network addresses');
 const addresses=isIP(host)?[{address:host}]:await lookup(host,{all:true});
 if(!addresses.length||addresses.some(a=>isPrivateAddress(a.address)))throw new Error('FetchURL blocks local and private network addresses');
}
