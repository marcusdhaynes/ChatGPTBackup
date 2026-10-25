/* Indexed and rendered entirely inside a dedicated browser worker. No network calls. */
const conversations=new Map();
const titles=new Map();
let serial=0;
const s=v=>v==null?'':String(v);
const safeTime=v=>{const n=Number(v);return Number.isFinite(n)&&n>0?(n>1e12?n:n*1000):0};
const safeObj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
function isMediaPart(p){return !!(p&&typeof p==='object'&&(p.asset_pointer||p.file_id||p.file_name||p.url||/asset_pointer|video_container|file|image|audio|video|pdf/i.test(s(p.content_type||p.type))));}
function assetFromPart(p){
 const m=safeObj(p.metadata), n=safeObj(m.file), c=s(p.content_type||p.type).toLowerCase();
 const ref=s(p.asset_pointer||p.file_id||p.asset_id||p.url||n.asset_pointer||p.file_url||'');
 const name=s(p.file_name||p.name||p.title||n.name||m.filename||p.display_name||p.filename||'');
 const mime=s(p.mime_type||p.mime||m.mime_type||'');
 let type='file';const indicator=`${c} ${mime} ${name}`.toLowerCase();
 if(/image|\.png|\.jpe?g|\.gif|\.webp|\.svg|\.bmp/.test(indicator))type='image';
 else if(/video|\.mp4|\.mov|\.webm|\.mkv/.test(indicator))type='video';
 else if(/audio|speech|\.wav|\.mp3|\.m4a|\.ogg/.test(indicator))type='audio';
 else if(/pdf|\.pdf/.test(indicator))type='pdf';
 else if(/\.docx?|document|\.rtf/.test(indicator))type='document';
 else if(/\.zip|\.7z|\.rar/.test(indicator))type='archive';
 const pointer=ref||s(p.id||'');
 return {kind:'asset',type,ref:pointer,name:name||decodeName(pointer)||`${type.charAt(0).toUpperCase()+type.slice(1)} attachment`,mime,size:Number(p.size_bytes||p.size||0)||0};
}
function decodeName(ref){try{const t=decodeURIComponent(s(ref).split('/').pop()?.split('?')[0]||'');return t||''}catch{return s(ref).split('/').pop()||''}}
function piecesFromText(value){
 const str=s(value);if(!str)return [];
 // Convert references to non-HTTP file-service assets into an in-place placeholder, including files omitted by the export.
 const pattern=/(!?)\[([^\]]*)\]\(((?:sandbox:|file-service:|sediment:|attachment:)[^\s)]+)\)/g;
 let result=[],last=0,m;
 while((m=pattern.exec(str))!==null){if(m.index>last)result.push({kind:'text',text:str.slice(last,m.index)});
 const ref=m[3],name=m[2]||decodeName(ref),p=assetFromPart({asset_pointer:ref,file_name:name,content_type:m[1]?'image_asset_pointer':'file'});result.push(p);last=pattern.lastIndex;}
 if(last<str.length)result.push({kind:'text',text:str.slice(last)});return result;
}
function parseParts(message){
 const content=safeObj(message.content),parts=Array.isArray(content.parts)?content.parts:(Array.isArray(content.content)?content.content:null);
 let out=[];
 const meta=safeObj(message.metadata);
 const attachments=[...(Array.isArray(meta.attachments)?meta.attachments:[]),...(Array.isArray(content.attachments)?content.attachments:[])];
 const used=new Set();
 const appendAsset=p=>{const a=assetFromPart(p);const key=a.ref||a.name;if(key&&used.has(key))return;if(key)used.add(key);out.push(a)};
 // In the original ChatGPT composer, uploaded files are shown above the typed message.
 for(const a of attachments)appendAsset(a);
 function append(p,level=0){if(level>6||p==null)return;
 if(typeof p==='string'||typeof p==='number'){out.push(...piecesFromText(p));return}
 if(Array.isArray(p)){p.forEach(x=>append(x,level+1));return}
 if(typeof p!=='object')return;
 const c=s(p.content_type||p.type).toLowerCase();
 if(c==='text'||c==='string_part'||c==='audio_transcription'||c==='text_content'||c==='input_text'||c==='output_text'||c==='audio_text'){
   const t=p.text??p.transcript??p.content??p.value;if(typeof t==='string')out.push(...piecesFromText(t));else if(t)append(t,level+1);return;
 }
 if(c==='real_time_user_audio_video_asset_pointer'){
   if(p.audio_asset_pointer)appendAsset({asset_pointer:p.audio_asset_pointer,content_type:'audio_asset_pointer',file_name:p.file_name});
   if(p.video_container_asset_pointer)appendAsset({asset_pointer:p.video_container_asset_pointer,content_type:'video_container_asset_pointer'});
   if(Array.isArray(p.frames_asset_pointers))p.frames_asset_pointers.forEach(x=>append(x,level+1));return;
 }
 if(isMediaPart(p)&&(p.asset_pointer||p.file_id||p.file_name||p.url||p.content_type?.includes('pointer'))) {appendAsset(p);return}
 if(p.text!=null){append(p.text,level+1);return}
 if(p.transcript!=null){append(p.transcript,level+1);return}
 if(p.parts!=null){append(p.parts,level+1);return}
 if(p.content!=null){append(p.content,level+1);return}
 if(p.caption)append(p.caption,level+1);
 }
 if(parts)append(parts);
 else if(typeof content.text==='string')append(content.text);
 else if(typeof content.result==='string')append(content.result);
 else if(typeof content.content==='string')append(content.content);
 else if(typeof content==='object'&&content.content_type==='code'&&content.code)append(`\`\`\`${content.language||''}\n${content.code}\n\`\`\``);
 if(!out.length&&Array.isArray(content.thoughts))for(const item of content.thoughts){const text=[s(item.summary),s(item.content)].filter(Boolean).join('\n\n');if(text)out.push({kind:'thinking',text})}
 const refs=Array.isArray(meta.content_references)?meta.content_references:[];
 for(const part of out){if(part.kind!=='text')continue;for(const r of refs){const token=s(r.matched_text);if(!token||!/[\ue200-\ue2ff]/.test(token))continue;const alt=s(r.alt);if(alt)part.text=part.text.split(token).join(alt)}}
 return out.filter(p=>p.kind==='asset'||p.text?.trim());
}
function messagesOf(obj){
 const mapping=safeObj(obj.mapping);if(Object.keys(mapping).length){
  const entries=Object.entries(mapping);return entries.map(([id,node])=>({node:safeObj(node),id}));
 }
 if(Array.isArray(obj.messages))return obj.messages.map((node,i)=>({id:s(node.id||node.message?.id||i),node:node.message?node:{message:node,id:node.id,parent:node.parent,children:node.children}}));
 if(obj.message||obj.content)return [{id:s(obj.id||'single'),node:{message:obj.message||obj}}];
 return [];
}
function buildMessages(obj,allBranches=false){
 const nodes=messagesOf(obj),map=new Map(nodes.map(x=>[x.id,x]));let chosen=null;
 if(!allBranches&&nodes.length&&Object.keys(safeObj(obj.mapping)).length){
  let id=s(obj.current_node||'');
  if(!map.has(id)){
   const leaves=nodes.filter(x=>!Array.isArray(x.node.children)||!x.node.children.length);
   const arr=leaves.length?leaves:nodes;
   arr.sort((a,b)=>safeTime(a.node.message?.create_time)-safeTime(b.node.message?.create_time));id=arr.at(-1).id;
  }
  const chain=[],seen=new Set();let steps=0;while(id&&map.has(id)&&!seen.has(id)&&steps++<100000){seen.add(id);chain.push(map.get(id));id=s(map.get(id).node.parent||'')}
  chosen=chain.reverse();
 }
 const picked=chosen||nodes.slice().sort((a,b)=>(safeTime(a.node.message?.create_time||a.node.create_time)-safeTime(b.node.message?.create_time||b.node.create_time)));
 return picked.map(({id,node},index)=>{
   const msg=safeObj(node.message);if(!Object.keys(msg).length)return null;
   const author=safeObj(msg.author),role=s(author.role||msg.role||'assistant').toLowerCase();
   const parts=parseParts(msg),meta=safeObj(msg.metadata);
   if(!parts.length&&['system','tool','developer'].includes(role))return null;
   return {id,role,author:s(author.name||''),timestamp:safeTime(msg.create_time||node.create_time),parts,model:s(meta.model_slug||meta.request_id&&obj.default_model_slug||''),index,branch:!chosen&&!!node.parent};
 }).filter(Boolean).filter(m=>m.parts.length>0||m.role==='user');
}
function processRecord(obj,raw,source){
 if(!obj||typeof obj!=='object'||Array.isArray(obj))return null;
 if(!obj.mapping&&!obj.messages&&!obj.message&&!obj.content)return null;
 let id=s(obj.conversation_id||obj.id||`${source}-${++serial}`);
 let title=s(obj.title||obj.name||'Untitled conversation').trim()||'Untitled conversation';
 const messages=buildMessages(obj,false),count=messages.filter(m=>m.role==='user'||m.role==='assistant').length;
 const mediaRefs=[],seen=new Set();let snippet='';const search=[];
 for(const m of messages){for(const p of m.parts){if(p.kind==='asset'){
  const key=p.ref||p.name;if(!seen.has(key)){seen.add(key);mediaRefs.push({ref:p.ref,name:p.name,type:p.type})}
 }else if(p.text){if(!snippet&&m.role==='user')snippet=p.text.slice(0,300);search.push(p.text)}}}
 const date=safeTime(obj.update_time||obj.create_time)||messages.at(-1)?.timestamp||0;
 const summary={id,title,date,created:safeTime(obj.create_time),count,media:mediaRefs.length,mediaRefs,source,snippet:snippet.slice(0,240)||search.find(Boolean)?.slice(0,240)||'',branchCount:Math.max(0,messagesOf(obj).length-messages.length)};
 const prior=conversations.get(id);if(prior&&prior.summary.date>date)return null;
 conversations.set(id,{raw,summary,search:(title+' '+search.join(' ')).toLowerCase()});titles.set(id,title);return summary;
}
let batch=[];function flush(){if(batch.length){postMessage({type:'batch',summaries:batch});batch=[]}}
function addOne(text,source){try{const obj=JSON.parse(text);const result=processRecord(obj,text,source);if(result){batch.push(result);if(batch.length>=40)flush()}}catch(e){if(text.length>40)postMessage({type:'warning',message:`Skipped one invalid record in ${source}: ${s(e.message)}`})}}
async function parseStream(blob,source){
 const reader=blob.stream().getReader(),decoder=new TextDecoder('utf-8');let mode='',capturing=false,level=0,str=false,escaped=false,parts=[],bytes=0,unparsed=[],reports=0;
 function chunk(text){if(!text)return;
  if(mode==='object'){unparsed.push(text);return}
  let start=-1;
  for(let i=0;i<text.length;i++){
   const ch=text[i];
   if(!mode){if(/\s/.test(ch)||ch==='\ufeff')continue;if(ch==='['){mode='array';continue}if(ch==='{'){mode='object';unparsed.push(text.slice(i));return}mode='invalid';return}
   if(mode==='invalid')return;
   if(!capturing){if(ch==='{'){capturing=true;level=1;str=false;escaped=false;parts=[];start=i}continue}
   if(i===start)continue;
   if(str){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')str=false;continue}
   if(ch==='"'){str=true;continue}
   if(ch==='{'||ch==='[')level++;
   else if(ch==='}'||ch===']')level--;
   if(level===0){parts.push(text.slice(start<0?0:start,i+1));addOne(parts.join(''),source);capturing=false;start=-1;parts=[];}
  }
  if(capturing)parts.push(text.slice(start<0?0:start));
 }
 while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;chunk(decoder.decode(value,{stream:true}));if(bytes-reports>4*1024*1024){reports=bytes;flush();postMessage({type:'progress',source,percent:blob.size?Math.round(100*bytes/blob.size):100})}}
 chunk(decoder.decode());if(mode==='object'){
  const txt=unparsed.join('');let obj;try{obj=JSON.parse(txt)}catch(e){throw new Error(`Could not read ${source}: ${e.message}`)}
  if(Array.isArray(obj.conversations)){for(const c of obj.conversations){const raw=JSON.stringify(c);addOne(raw,source)}}
  else addOne(txt,source);
 }
 flush();postMessage({type:'progress',source,percent:100});
}
self.onmessage=async e=>{const d=e.data||{};
 if(d.type==='clear'){conversations.clear();titles.clear();serial=0;postMessage({type:'cleared'});return}
 if(d.type==='parse'){try{await parseStream(d.blob,d.source||d.blob?.name||'JSON');postMessage({type:'file-done',source:d.source})}catch(err){postMessage({type:'error',message:s(err.message),source:d.source})}return}
 if(d.type==='detail'){const entry=conversations.get(d.id);if(!entry){postMessage({type:'detail',id:d.id,messages:[]});return}
  try{const data=JSON.parse(entry.raw);const messages=buildMessages(data,!!d.allBranches);postMessage({type:'detail',id:d.id,messages,summary:entry.summary})}catch(err){postMessage({type:'error',message:`Conversation could not be loaded: ${err.message}`})}return;
 }
 if(d.type==='search'){
  const q=s(d.query).toLowerCase().trim().split(/\s+/).filter(Boolean),dateMode=d.date||'all',type=d.filter||'all',now=Date.now();const missing=new Set(d.missingIds||[]);
  let rows=[];for(const [id,item] of conversations){const a=item.summary;
   if(q.length&&!q.every(word=>item.search.includes(word)))continue;
   if(type==='media'&&!a.media)continue;if(type==='long'&&a.count<50)continue;if(type==='missing'&&!missing.has(id))continue;
   if(dateMode==='30'&&(!a.date||now-a.date>30*864e5))continue;if(dateMode==='365'&&(!a.date||now-a.date>365*864e5))continue;if(dateMode==='older'&&a.date&&now-a.date<365*864e5)continue;
   rows.push(a);
  }
  const sort=d.sort||'recent';rows.sort((a,b)=>sort==='oldest'?(a.date-b.date):sort==='title'?a.title.localeCompare(b.title):sort==='longest'?(b.count-a.count):b.date-a.date);
  postMessage({type:'results',request:d.request,total:rows.length,results:rows.slice(0,12000).map(x=>x.id)});return;
 }
};
