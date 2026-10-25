/* Dependency-free, lazy ZIP central-directory reader, including ZIP64 sizes/offsets.
   Media is not decompressed until the user opens it. */
const decoder=new TextDecoder();
const u16=(v,i)=>v.getUint16(i,true),u32=(v,i)=>v.getUint32(i,true);
function bigint64(v,i){return Number(v.getBigUint64(i,true))}
export async function openZip(blob){
 const tailSize=Math.min(blob.size,1024*128),tailStart=blob.size-tailSize;
 const tail=new DataView(await blob.slice(tailStart).arrayBuffer());let eocd=-1;
 for(let i=tail.byteLength-22;i>=0;i--){if(u32(tail,i)===0x06054b50&&i+22+u16(tail,i+20)<=tail.byteLength){eocd=i;break}}
 if(eocd<0)throw Error('Not a valid ZIP archive (central directory missing).');
 let count=u16(tail,eocd+10),size=u32(tail,eocd+12),offset=u32(tail,eocd+16);
 if(count===65535||size===0xffffffff||offset===0xffffffff){
  const locator=eocd-20;
  if(locator>=0&&u32(tail,locator)===0x07064b50){
   const position=bigint64(tail,locator+8);
   const b=new DataView(await blob.slice(position,position+56).arrayBuffer());
   if(u32(b,0)===0x06064b50){count=bigint64(b,32);size=bigint64(b,40);offset=bigint64(b,48)}
  }
 }
 if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset+size>blob.size||size>1024*1024*256)throw Error('ZIP directory is too large or malformed.');
 const d=new DataView(await blob.slice(offset,offset+size).arrayBuffer());
 let i=0,entries=[];
 while(i+46<=d.byteLength&&entries.length<count){
  if(u32(d,i)!==0x02014b50)break;
  const flags=u16(d,i+8),method=u16(d,i+10),compressed32=u32(d,i+20),uncompressed32=u32(d,i+24),fnlen=u16(d,i+28),exlen=u16(d,i+30),commentlen=u16(d,i+32);
  const diskStart=u16(d,i+34),offset32=u32(d,i+42);
  const full=i+46+fnlen+exlen+commentlen;if(full>d.byteLength)throw Error('Truncated ZIP directory.');
  const name=decoder.decode(new Uint8Array(d.buffer,d.byteOffset+i+46,fnlen));
  let compressed=compressed32,uncompressed=uncompressed32,localOffset=offset32;
  let j=i+46+fnlen;const end=j+exlen;
  while(j+4<=end){const kind=u16(d,j),n=u16(d,j+2);j+=4;if(j+n>end)break;
   if(kind===1){let k=j;if(uncompressed32===0xffffffff){uncompressed=bigint64(d,k);k+=8}if(compressed32===0xffffffff){compressed=bigint64(d,k);k+=8}if(offset32===0xffffffff){localOffset=bigint64(d,k);k+=8}if(diskStart===0xffff)k+=4}
   j+=n;
  }
  if(!Number.isSafeInteger(localOffset)||!Number.isSafeInteger(compressed)||!Number.isSafeInteger(uncompressed))throw Error('ZIP file is beyond supported browser addressing limits.');
  if(!name.endsWith('/'))entries.push({name,compressed,uncompressed,method,encrypted:!!(flags&1),localOffset});
  i=full;
 }
 async function getBlob(entry){
  if(entry.encrypted)throw Error('Password-protected ZIP entries cannot be opened.');
  const h=new DataView(await blob.slice(entry.localOffset,entry.localOffset+30).arrayBuffer());
  if(h.byteLength<30||u32(h,0)!==0x04034b50)throw Error(`Invalid ZIP entry: ${entry.name}`);
  const dataStart=entry.localOffset+30+u16(h,26)+u16(h,28),end=dataStart+entry.compressed;
  if(end>blob.size)throw Error(`Truncated ZIP entry: ${entry.name}`);
  const raw=blob.slice(dataStart,end);
  if(entry.method===0)return raw;
  if(entry.method!==8)throw Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}`);
  if(typeof DecompressionStream!=='function')throw Error('This browser does not support ZIP decompression. Use a current Chrome, Firefox, Safari or Edge browser.');
  try{return await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob()}
  catch(e){throw Error(`Unable to decompress ${entry.name}: ${e.message||'unsupported compression'}`)}
 }
 return {entries,getBlob};
}
export function signatureMime(bytes,name=''){
 const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);const eq=(...a)=>a.every((v,i)=>b[i]===v);
 if(eq(0x89,0x50,0x4e,0x47))return 'image/png';
 if(eq(0xff,0xd8,0xff))return 'image/jpeg';
 if(eq(0x47,0x49,0x46,0x38))return 'image/gif';
 if(eq(0x52,0x49,0x46,0x46)&&String.fromCharCode(...b.slice(8,12))==='WEBP')return 'image/webp';
 if(eq(0x52,0x49,0x46,0x46)&&String.fromCharCode(...b.slice(8,12))==='WAVE')return 'audio/wav';
 if(eq(0x25,0x50,0x44,0x46))return 'application/pdf';
 if(eq(0x50,0x4b,0x03,0x04))return 'application/zip';
 if(b[4]===0x66&&b[5]===0x74&&b[6]===0x79&&b[7]===0x70)return 'video/mp4';
 if(eq(0x1a,0x45,0xdf,0xa3))return 'video/webm';
 if(eq(0x49,0x44,0x33)||eq(0xff,0xfb))return 'audio/mpeg';
 if(eq(0x4f,0x67,0x67,0x53))return 'audio/ogg';
 const ext=name.toLowerCase().split('.').pop(),known={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',txt:'text/plain',md:'text/markdown',json:'application/json',zip:'application/zip',html:'text/html',css:'text/css',js:'text/javascript'};
 return known[ext]||'application/octet-stream';
}
