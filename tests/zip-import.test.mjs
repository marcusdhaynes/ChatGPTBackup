import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {openZip} from '../zip.js';
import {deflateRawSync} from 'node:zlib';

const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const start=source.indexOf('const isZip=n=>'),end=source.indexOf('async function importFiles(files)',start);
assert.ok(start>=0&&end>start,'Archive importer must exist');
const assets=[],state={warnings:[],importCancelled:false};
const basename=s=>String(s).replace(/\\/g,'/').split('/').pop();
const {collectArchive}=vm.runInNewContext(source.slice(start,end)+';({collectArchive})',{
 openZip,state,loading:()=>{},basename,addAsset:(name,load)=>assets.push({name,load}),Blob,console,Error
});

const outer=new Blob([fs.readFileSync(new URL('./sample-export.zip',import.meta.url))]);
let queue=[],names=[],alternatives=[];
await collectArchive([{name:'chat-export.zip',blob:outer}],queue,names,alternatives);
assert.equal(queue.length,1,'Must load conversations inside nested ZIP without extraction');
assert.equal(JSON.parse(await (await queue[0].load()).text()).length,2);
assert.ok(assets.some(a=>a.name==='file-IMG123.dat'),'Nested DAT media must be indexed');

const enc=new TextEncoder();
const bytes=enc.encode(JSON.stringify([{id:'custom',title:'Imported directly from ZIP',messages:[{role:'user',content:{parts:['hello']}}]}]));
function makeZip(name,payload){
 const n=enc.encode(name),z=deflateRawSync(payload),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(z.length,18);local.writeUInt32LE(payload.length,22);local.writeUInt16LE(n.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(z.length,20);central.writeUInt32LE(payload.length,24);central.writeUInt16LE(n.length,28);
 const offset=local.length+n.length+z.length;
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+n.length,12);end.writeUInt32LE(offset,16);
 return new Blob([local,n,z,central,n,end]);
}
queue=[];names=[];alternatives=[];
await collectArchive([{name:'original-export.zip',blob:makeZip('backup/data/chat_history_2026.json',bytes)}],queue,names,alternatives);
assert.equal(queue.length,0);
assert.equal(alternatives.length,1,'Unusual JSON filenames must be discoverable in ZIP');
assert.match(await (await alternatives[0].load()).text(),/Imported directly from ZIP/);
console.log('Direct ZIP import regression tests passed.');
