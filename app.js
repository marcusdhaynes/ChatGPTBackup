import {openZip,signatureMime} from './zip.js';
const $=id=>document.getElementById(id);
const state={worker:null,summary:new Map(),assets:new Map(),missingIds:new Set(),results:[],total:0,visible:60,selected:null,messages:[],rendered:0,loading:false,querySeq:0,showAllBranches:false,objectUrls:[],warnings:[],imports:0,assetNames:new Map()};
const escaped=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const friendlyDate=n=>n?new Date(n).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'Unknown date';
const friendlyTime=n=>n?new Date(n).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'';
const shortNumber=n=>Number(n||0).toLocaleString();
let toastTimer,searchTimer,scrollObserver;
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),3200)}
function show(id){for(const view of ['welcome','library','chat'])$(view).hidden=view!==id;}
function setTheme(theme){document.body.classList.toggle('dark',theme==='dark');try{localStorage.setItem('appearance',theme)}catch{}}
try{setTheme(localStorage.getItem('appearance')|| (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'))}catch{setTheme('light')}
function toggleTheme(){setTheme(document.body.classList.contains('dark')?'light':'dark')}
function toggleSidebar(open){$('sidebar').classList.toggle('open',open);$('scrim').hidden=!open}
function loading(value,title='',detail='',fraction=0){state.loading=value;$('loading').hidden=!value;if(!value)return;$('loading-title').textContent=title;$('loading-detail').textContent=detail;$('progress-bar').style.width=`${Math.max(2,Math.min(100,fraction))}%`}
function installWorker(){
 const worker=new Worker('./parser.worker.js');state.worker=worker;
 worker.onmessage=e=>{const d=e.data||{};
  if(d.type==='batch'){for(const a of d.summaries)state.summary.set(a.id,a);$('total-chats').textContent=shortNumber(state.summary.size);$('sidebar-count').textContent=shortNumber(state.summary.size)}
  if(d.type==='progress')loading(true,'Indexing conversations…',`${d.source} · ${d.percent}%`,Math.round(d.percent*.8)+15);
  if(d.type==='warning'){if(state.warnings.length<15)state.warnings.push(d.message)}
  if(d.type==='error'){state.warnings.push(d.message);if(worker._pending){worker._pending.resolve({error:d.message});worker._pending=null}else toast(d.message)}
  if(d.type==='file-done'&&worker._pending){worker._pending.resolve({ok:true});worker._pending=null}
  if(d.type==='results'&&d.request===state.querySeq){state.results=d.results;state.total=d.total;state.visible=60;renderLibraryResults()}
  if(d.type==='detail'&&d.id===state.selected){state.messages=d.messages;state.rendered=0;renderMessages(true)}
 };
 worker.onerror=e=>{const message=e.message||'Could not start the indexing worker.';toast(message);if(worker._pending){worker._pending.resolve({error:message});worker._pending=null}};
}
installWorker();
function canonical(s){return decodeSafe(String(s||'').toLowerCase()).replace(/[?#].*$/,'').replace(/^(?:file-service|sediment|sandbox|attachment):\/*/,'').replace(/[^a-z0-9]/g,'')}
function decodeSafe(s){try{return decodeURIComponent(s)}catch{return s}}
function basename(s){return decodeSafe(String(s||'').replace(/\\/g,'/').split('/').pop()?.split('?')[0]||'')}
function keysFor(value){if(!value)return[];const v=String(value),base=basename(v);const out=new Set();for(const x of [v,base,base.match(/file[-_][a-z0-9]+/i)?.[0]||'',base.replace(/\.(?:dat|png|jpe?g|gif|webp|mp4|webm|pdf|txt|mp3|wav|m4a|zip|docx?|svg)$/i,''),base.replace(/^file[-_]/i,'').replace(/\.[^.]+$/,'')]){const k=canonical(x);if(k)out.add(k)}return [...out]}
function addAsset(name,load){const asset={name,load,blob:null,promise:null};for(const key of keysFor(name)){if(!state.assets.has(key))state.assets.set(key,asset)}return asset}
function findAsset(ref,name){for(const k of [...keysFor(ref),...keysFor(name)]){if(state.assets.has(k))return state.assets.get(k)}return null}
function nameForAsset(p){for(const key of [...keysFor(p.ref),...keysFor(p.name)]){const found=state.assetNames.get(key);if(found)return found}
 const value=String(p.name||'');return value || 'Unnamed attachment';}
async function readNames(queue){for(const item of queue){try{const blob=await item.load();if(blob.size>20*1024*1024)continue;const mapping=JSON.parse(await blob.text());if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))continue;
 for(const [ref,original] of Object.entries(mapping)){if(typeof original!=='string')continue;const label=basename(original);for(const key of keysFor(ref)){state.assetNames.set(key,label)}
 }}catch(e){state.warnings.push(`Asset names index ${item.name}: ${e.message}`)}}}
function updateMissing(){state.missingIds.clear();for(const a of state.summary.values())if(a.mediaRefs?.some(p=>!findAsset(p.ref,p.name)))state.missingIds.add(a.id)}
async function getAssetBlob(asset){if(!asset)return null;if(asset.blob)return asset.blob;if(asset.promise)return asset.promise;asset.promise=(async()=>{const b=await asset.load(),mime=signatureMime(new Uint8Array(await b.slice(0,20).arrayBuffer()),asset.name);const actual=b.type===mime?b:b.slice(0,b.size,mime);if(actual.size<=8*1024*1024)asset.blob=actual;return actual})();try{return await asset.promise}finally{asset.promise=null}}
function addFiles(files){return files.map(f=>({name:f.webkitRelativePath||f.name,blob:f}));}
async function entryFiles(entry,prefix=''){
 if(entry.isFile)return new Promise(resolve=>entry.file(file=>resolve([{name:prefix+file.name,blob:file}]),()=>resolve([])));
 if(!entry.isDirectory)return [];
 const reader=entry.createReader(),children=[];while(true){const batch=await new Promise(resolve=>reader.readEntries(resolve,()=>resolve([])));if(!batch.length)break;children.push(...batch)}
 const result=[];for(const child of children)result.push(...await entryFiles(child,prefix+entry.name+'/'));return result;
}
async function droppedFiles(e){const items=[...(e.dataTransfer.items||[])];if(items.length&&items.some(x=>x.webkitGetAsEntry?.())){
 const list=[];for(const item of items){const ent=item.webkitGetAsEntry?.();if(ent)list.push(...await entryFiles(ent));else{const f=item.getAsFile();if(f)list.push({name:f.name,blob:f})}}return list;
 }return addFiles([...(e.dataTransfer.files||[])]);
}
const isZip=n=>/\.zip$/i.test(n),isJson=n=>/\.json$/i.test(n),isTextOrAsset=n=>!isZip(n)&&!isJson(n)&&!(/\/$/.test(n));
const isConversationJson=n=>/^(?:conversations?(?:[-_][\w-]+)?|chat[-_]?backup(?:[-_][\w-]+)?|export(?:[-_][\w-]+)?|history(?:[-_][\w-]+)?)\.json$/i.test(basename(n));
const isAuxiliaryJson=n=>/^(?:user|account|profile|message_feedback|shared_conversations|model_comparisons|export_manifest|conversation_asset_file_names|settings|metadata)(?:[-_][\w-]+)?\.json$/i.test(basename(n));
// Read ZIP central directories directly. Inflate JSON on demand; keep media lazy.
async function collectArchive(items,queue,nameQueue,alternatives=[],depth=0,scan={files:0,nested:0}){
 if(depth>5){state.warnings.push('Skipped ZIP nesting deeper than five levels.');return}
 for(const file of items){if(state.importCancelled)throw Error('Import cancelled');
  const name=file.name;
  if(isZip(name)){
   scan.nested++;
   if(scan.nested>120){state.warnings.push('Stopped opening nested ZIPs after 120 archives.');continue}
   loading(true,'Reading ZIP directly…',name,8);
   try{
    const zip=await openZip(file.blob),nested=[];
    for(const e of zip.entries){
     if(state.importCancelled)throw Error('Import cancelled');
     const fullName=`${name}/${e.name}`,item={name:fullName,load:()=>zip.getBlob(e)};
     if(basename(e.name)==='conversation_asset_file_names.json'){nameQueue.push(item);continue}
     if(isJson(e.name)){
      if(isConversationJson(e.name))queue.push(item);
      else if(!isAuxiliaryJson(e.name))alternatives.push(item);
      continue;
     }
     if(isZip(e.name)){nested.push(item);continue}
     if(isTextOrAsset(e.name))addAsset(e.name,item.load);
     scan.files++;
    }
    for(const child of nested){
     if(state.importCancelled)throw Error('Import cancelled');
     const blob=await child.load();
     await collectArchive([{name:child.name,blob}],queue,nameQueue,alternatives,depth+1,scan);
    }
   }catch(err){if(state.importCancelled)throw err;state.warnings.push(`${name}: ${err.message}`)}
  }else if(basename(name)==='conversation_asset_file_names.json'){nameQueue.push({name,load:async()=>file.blob})}
  else if(isJson(name)){const item={name,load:async()=>file.blob};if(isConversationJson(name)||depth===0)queue.push(item);else if(!isAuxiliaryJson(name))alternatives.push(item)}
  else if(isTextOrAsset(name))addAsset(name,async()=>file.blob);
 }
}
async function importFiles(files){if(!files.length)return;
 if(state.loading){toast('An import is already running.');return}
 state.importCancelled=false;state.warnings=[];state.imports++;
 const queue=[],nameQueue=[],alternatives=[];loading(true,'Opening your archive…',`${files.length} selected file${files.length===1?'':'s'}`,5);
 try{
  await collectArchive(files,queue,nameQueue,alternatives);if(!queue.length)queue.push(...alternatives);await readNames(nameQueue);
  if(queue.length===0){loading(false);if(!state.summary.size){toast(state.warnings[0]||'No conversation JSON found in that ZIP or folder.')}else{updateMissing();query();toast('Additional archive assets indexed.')}return}
  let i=0;for(const item of queue){if(state.importCancelled)break;i++;loading(true,`Importing JSON ${i} of ${queue.length}`,item.name,Math.round((i-1)/queue.length*90));
   try{const b=await item.load();await new Promise(resolve=>{state.worker._pending={resolve};state.worker.postMessage({type:'parse',blob:b,source:item.name})})}catch(err){state.warnings.push(`${item.name}: ${err.message}`)}
  }
  updateMissing();loading(false);query();renderSidebar();show('library');
  const count=state.summary.size;toast(`Ready: ${shortNumber(count)} conversation${count===1?'':'s'} · ${shortNumber(state.missingIds.size)} with missing media${state.warnings.length?' · See import notes below':''}`);
  if(state.warnings.length)$('library-description').textContent=`${state.warnings.length} import warning(s): ${state.warnings.slice(0,2).join(' · ').slice(0,230)}`;
 }catch(e){loading(false);toast(e.message||'The archive could not be opened.');if(state.summary.size){query();show('library')}}
}
function query(){if(!state.summary.size){show('welcome');return}const request=++state.querySeq;state.worker.postMessage({type:'search',request,query:$('search').value,date:$('date-filter').value,filter:$('type-filter').value,sort:$('sort').value,missingIds:$('type-filter').value==='missing'?[...state.missingIds]:[]})}
function dateGroup(n){if(!n)return'Unknown date';const d=new Date(n),today=new Date();const todayStart=new Date(today.getFullYear(),today.getMonth(),today.getDate()).getTime();const delta=(todayStart-new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime())/864e5;if(delta===0)return'Today';if(delta===1)return'Yesterday';if(delta>=0&&delta<=7)return'Previous 7 days';if(delta>=0&&delta<=30)return'Previous 30 days';return d.toLocaleDateString(undefined,{month:'long',year:'numeric'})}
function renderSidebar(){const nav=$('conversation-list');nav.replaceChildren();const summaries=[...state.summary.values()].sort((a,b)=>b.date-a.date);let last='';
 for(const a of summaries.slice(0,2500)){
  const group=dateGroup(a.date);if(group!==last){const cap=document.createElement('div');cap.className='side-group';cap.textContent=group;nav.append(cap);last=group}
  const b=document.createElement('button');b.className='side-item'+(state.selected===a.id?' active':'');b.textContent=a.title;b.title=a.title;b.onclick=()=>openChat(a.id);nav.append(b);
 }
 if(summaries.length>2500){const tip=document.createElement('div');tip.className='sidebar-tip';tip.textContent='The first 2,500 chats are shown here. Use Search to find all others.';nav.append(tip)}
 $('sidebar-count').textContent=shortNumber(summaries.length);
}
function renderLibraryResults(){const root=$('library-results');root.replaceChildren();$('results-summary').textContent=`${shortNumber(state.total)} matching conversation${state.total===1?'':'s'}`;$('total-chats').textContent=shortNumber(state.summary.size);const ids=state.results.slice(0,state.visible);
 if(!ids.length){const empty=document.createElement('div');empty.className='empty-results';empty.textContent='No conversations match these filters. Try a different search.';root.append(empty)}
 for(const id of ids){const a=state.summary.get(id);if(!a)continue;
  const button=document.createElement('button');button.className='result-card';button.setAttribute('role','listitem');
  const top=document.createElement('div');top.className='card-top';const time=document.createElement('span');time.textContent=friendlyDate(a.date);const ico=document.createElement('span');ico.textContent='↗';top.append(time,ico);
  const title=document.createElement('div');title.className='card-title';title.textContent=a.title;
  const snippet=document.createElement('div');snippet.className='card-snippet';snippet.textContent=a.snippet||'Open this archived conversation.';
  const bottom=document.createElement('div');bottom.className='card-bottom';const count=document.createElement('span');count.textContent=`${shortNumber(a.count)} messages`;bottom.append(count);
  if(a.media){const media=document.createElement('span');media.className='file-chip';media.textContent=`▧ ${shortNumber(a.media)} file${a.media===1?'':'s'}`;bottom.append(media)}
  if(state.missingIds.has(id)){const miss=document.createElement('span');miss.className='missing-chip';miss.textContent='◌ Missing media';bottom.append(miss)}
  button.append(top,title,snippet,bottom);button.onclick=()=>openChat(id);root.append(button);
 }
 $('load-more').hidden=state.visible>=state.results.length||state.visible>=state.total;
}
function requestDetail(){if(!state.selected)return;state.worker.postMessage({type:'detail',id:state.selected,allBranches:state.showAllBranches})}
function openChat(id){const a=state.summary.get(id);if(!a)return;state.selected=id;state.showAllBranches=false;$('all-branches').checked=false;$('chat-title').textContent=a.title;$('chat-info').textContent=`${friendlyDate(a.created||a.date)} · ${shortNumber(a.count)} messages · ${a.source}`;
 for(const url of state.objectUrls)URL.revokeObjectURL(url);state.objectUrls=[];
 $('message-list').replaceChildren();state.messages=[];show('chat');requestDetail();renderSidebar();toggleSidebar(false);$('chat-scroll').scrollTop=0;
}
function icon(type){const paths={image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.3" cy="8.3" r="1.5"/><path d="m3.5 17 5.2-5 4 3.5 3-3 4.8 5.5"/>',video:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4z"/>',audio:'<path d="M10 5 6 9H3v6h3l4 4V5zM14 9a4 4 0 0 1 0 6M17 6a8 8 0 0 1 0 12"/>',pdf:'<path d="M7 2h7l5 5v15H5V2zM14 2v5h5M8 17h8M8 13h8"/>',document:'<path d="M7 2h7l5 5v15H5V2zM14 2v5h5M8 12h8M8 16h8"/>',archive:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M11 4v3m2 2v3m-2 2v2m2 2v2"/>',file:'<path d="M7 2h7l5 5v15H5V2zM14 2v5h5"/>'};return `<svg aria-hidden="true" viewBox="0 0 24 24">${paths[type]||paths.file}</svg>`}
// Only render navigable http(s) links. Everything else remains escaped text.
function safeExternalHref(value){
 let raw=String(value||'').trim().replace(/&amp;/gi,'&');
 const wrapped=raw.match(/^\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\)$/i);
 if(wrapped)raw=wrapped[1];
 try{const u=new URL(raw);return (u.protocol==='https:'||u.protocol==='http:')?u.href:null}
 catch{return null}
}
function formatInline(s){
 const protectedSpans=[];
 const save=html=>'\u0002LINKSPAN'+(protectedSpans.push(html)-1)+'\u0003';
 const anchor=(value,label)=>{
  const href=safeExternalHref(value);
  return href?save('<a href="'+escaped(href)+'" target="_blank" rel="noopener noreferrer">'+escaped(label||href)+'</a>'):null;
 };
 let text=String(s??'');
 // Protect inline code before recognizing links. Code should always display literally.
 text=text.replace(/`([^`\n]+)`/g,(_,code)=>save('<code>'+escaped(code)+'</code>'));
 // ChatGPT export link components, including Markdown-escaped \<Link tags.
 text=text.replace(/\\?<Link\b([^>]*?)(?:\/\s*>|>([^<]*)<\/Link\s*>)/gi,(full,attrs,body)=>{
  const url=attrs.match(/\burl\s*=\s*(["'])(.*?)\1/i);
  const title=attrs.match(/\btitle\s*=\s*(["'])(.*?)\1/i);
  if(!url)return full;
  return anchor(url[2],title?.[2]||body||url[2])||full;
 });
 // Regular Markdown links, including URLs whose path contains parentheses.
 text=text.replace(/\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^)]*\))+)\)/gi,(full,label,url)=>anchor(url,label)||full);
 // Plain URLs from archived conversations should also be clickable.
 text=text.replace(/(^|[\s(\[{])((?:https?:\/\/)[^\s<>"'\]\u0002\u0003]+)/gi,(full,prefix,raw)=>{
  let url=raw.replace(/[.,;!?]+$/,'');
  if(url.endsWith(')')&&(url.match(/\(/g)||[]).length<(url.match(/\)/g)||[]).length)url=url.slice(0,-1);
  const link=anchor(url,url);
  return link?prefix+link+raw.slice(url.length):full;
 });
 text=escaped(text);
 text=text.replace(/\*\*([\s\S]+?)\*\*/g,'<strong>$1</strong>').replace(/__([^\n]+?)__/g,'<strong>$1</strong>').replace(/~~([^\n]+?)~~/g,'<del>$1</del>').replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<em>$2</em>');
 return text.replace(/\u0002LINKSPAN(\d+)\u0003/g,(_,n)=>protectedSpans[Number(n)]||'');
}
function markdown(md){
 const lines=String(md).split(/\r?\n/),out=[];let i=0,code=false,codeLines=[],lang='';
 const flushCode=()=>{out.push(`<pre><code>${escaped(codeLines.join('\n'))}</code></pre>`);codeLines=[];code=false};
 while(i<lines.length){const line=lines[i];const trimmed=line.trim();
  if(/^\s*```/.test(line)){if(code)flushCode();else{code=true;lang=trimmed.slice(3)}i++;continue}
  if(code){codeLines.push(line);i++;continue}
  if(!trimmed){i++;continue}
  if(/^#{1,3}\s/.test(trimmed)){const depth=trimmed.match(/^#+/)[0].length;out.push(`<h${depth}>${formatInline(trimmed.slice(depth).trim())}</h${depth}>`);i++;continue}
  if(/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)){out.push('<hr>');i++;continue}
  if(/^>\s?/.test(line)){const text=[];while(i<lines.length&&/^>\s?/.test(lines[i]))text.push(lines[i++].replace(/^>\s?/,''));out.push(`<blockquote>${text.map(formatInline).join('<br>')}</blockquote>`);continue}
  if(/^\s*(?:[-*+]\s|\d+\.\s)/.test(line)){const ordered=/^\s*\d+\.\s/.test(line),list=[];while(i<lines.length&&/^\s*(?:[-*+]\s|\d+\.\s)/.test(lines[i])){list.push(`<li>${formatInline(lines[i++].replace(/^\s*(?:[-*+]\s|\d+\.\s)/,''))}</li>`)}out.push(`<${ordered?'ol':'ul'}>${list.join('')}</${ordered?'ol':'ul'}>`);continue}
  if(line.includes('|')&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])){
   const cells=l=>l.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());const heads=cells(line);i+=2;const rows=[];
   while(i<lines.length&&lines[i].includes('|')&&lines[i].trim()){rows.push(cells(lines[i++]));}
   out.push(`<table><thead><tr>${heads.map(h=>`<th>${formatInline(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(h=>`<td>${formatInline(h)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);continue;
  }
  const para=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^(?:\s*```|\s*#{1,3}\s|\s*>|\s*[-*+]\s|\s*\d+\.\s)/.test(lines[i]))para.push(lines[i++]);out.push(`<p>${para.map(formatInline).join('<br>')}</p>`);
 }
 if(code)flushCode();return out.join('');
}
function makeAttachment(p){const available=findAsset(p.ref,p.name),type=p.type||'file';const outer=document.createElement('div');outer.className='msg-asset';
 const label=nameForAsset(p),ref=p.ref||'';
 if(!available){const box=document.createElement('div');box.className='attachment missing';box.setAttribute('aria-label',`Missing ${type}: ${label}. Original reference ${ref}`);
  const iconBox=document.createElement('div');iconBox.className='attachment-icon';iconBox.innerHTML=icon(type);
  const details=document.createElement('div');details.className='attachment-details';const title=document.createElement('span');title.className='attachment-title';title.textContent=label;title.title=label;
  const stateLabel=document.createElement('span');stateLabel.className='attachment-state';stateLabel.textContent=`${type.toUpperCase()} · Not included in export`;
  details.append(title,stateLabel);if(ref&&ref!==label){const pointer=document.createElement('span');pointer.className='attachment-pointer';pointer.textContent=`Original reference: ${ref}`;details.append(pointer)}
  const missing=document.createElement('span');missing.className='attachment-status';missing.textContent='⊘';box.append(iconBox,details,missing);outer.append(box);return outer;
 }
 const link=document.createElement('button');link.className='attachment available';link.setAttribute('aria-label',`Open ${type}: ${label}`);
 const iconBox=document.createElement('div');iconBox.className='attachment-icon';iconBox.innerHTML=icon(type);
 const details=document.createElement('div');details.className='attachment-details';const title=document.createElement('span');title.className='attachment-title';title.textContent=label;const status=document.createElement('span');status.className='attachment-state';status.textContent=`${type.charAt(0).toUpperCase()+type.slice(1)} · Click to open`;details.append(title,status);link.append(iconBox,details);outer.append(link);
 let live=false;link.onclick=async()=>{
  if(live)return;live=true;status.textContent='Opening local file…';
  try{const blob=await getAssetBlob(available);const url=URL.createObjectURL(blob);state.objectUrls.push(url);
   if(blob.type.startsWith('image/')){const image=document.createElement('img');image.className='attachment-image';image.alt=label;image.src=url;image.onclick=()=>window.open(url,'_blank','noopener');outer.replaceChildren(image);image.insertAdjacentHTML('afterend',`<div class="media-caption">${escaped(label)}</div>`)}
   else if(blob.type.startsWith('audio/')){const audio=document.createElement('audio');audio.className='media-audio';audio.controls=true;audio.src=url;outer.replaceChildren(audio)}
   else if(blob.type.startsWith('video/')){const video=document.createElement('video');video.className='media-video';video.controls=true;video.src=url;outer.replaceChildren(video)}
   else{window.open(url,'_blank','noopener');status.textContent='Opened in a new tab';live=false}
  }catch(e){status.textContent=`Unable to read file: ${e.message}`;live=false}
 };
 // Reveal locally available images without requiring an extra click.
 if(type==='image')link.click();return outer;
}
function renderMessage(m){const wrapper=document.createElement('article');const role=m.role==='user'?'user':m.role==='assistant'?'assistant':'tool';wrapper.className=`msg ${role}`;
 if(role!=='user'){const head=document.createElement('div');head.className='msg-role';const logo=document.createElement('div');logo.className='role-logo';logo.textContent=role==='assistant'?'✳':'◈';const name=document.createElement('span');name.className='role-name';name.textContent=role==='assistant'?'ChatGPT':m.author||m.role;head.append(logo,name);if(m.model){const model=document.createElement('span');model.className='role-meta';model.textContent=m.model;head.append(model)}wrapper.append(head)}
 const shell=document.createElement('div');shell.className='msg-shell';const parts=document.createElement('div');parts.className='msg-parts';
 for(const p of m.parts){if(p.kind==='asset')parts.append(makeAttachment(p));else if(p.kind==='text'){
   const content=document.createElement('div');content.className='msg-content';content.innerHTML=markdown(p.text);parts.append(content)
 }else if(p.kind==='thinking'){const details=document.createElement('details');details.className='thinking';const summary=document.createElement('summary');summary.textContent='Thinking';const content=document.createElement('div');content.className='msg-content';content.innerHTML=markdown(p.text);details.append(summary,content);parts.append(details)}
 }shell.append(parts);wrapper.append(shell);
 if(m.timestamp){const time=document.createElement('div');time.className='msg-timestamp';time.textContent=friendlyTime(m.timestamp);wrapper.append(time)}return wrapper;
}
function renderMessages(reset=false){if(reset){if(scrollObserver)scrollObserver.disconnect();$('message-list').replaceChildren();state.rendered=0;const a=state.summary.get(state.selected);$('chat-info').textContent=`${friendlyDate(a?.created||a?.date)} · ${shortNumber(state.messages.length)} visible messages${a?.branchCount?` · ${shortNumber(a.branchCount)} alternate nodes`:''}`;}
 const all=state.messages,root=$('message-list'),end=Math.min(all.length,state.rendered+75),frag=document.createDocumentFragment();for(let i=state.rendered;i<end;i++)frag.append(renderMessage(all[i]));root.append(frag);state.rendered=end;
 const old=$('message-sentinel');if(old)old.remove();if(end<all.length){const b=document.createElement('button');b.id='message-sentinel';b.className='load-more';b.textContent=`Show more messages (${shortNumber(all.length-end)} remaining)`;b.onclick=()=>renderMessages();root.append(b);
  scrollObserver=new IntersectionObserver(entries=>{if(entries.some(x=>x.isIntersecting)){scrollObserver.disconnect();renderMessages()}},{root:$('chat-scroll'),rootMargin:'1100px'});scrollObserver.observe(b);
 }
}
async function copyChat(){if(!state.selected)return;let text=`${state.summary.get(state.selected)?.title||'Conversation'}\n\n`;
 for(const m of state.messages){text+=`[${m.role}${m.timestamp?' · '+friendlyTime(m.timestamp):''}]\n`;for(const p of m.parts)text+=p.kind==='text'?p.text+'\n':`[${p.type.toUpperCase()} ${p.name} — ${findAsset(p.ref,p.name)?'available':'missing'}]\n`;text+='\n'}
 try{await navigator.clipboard.writeText(text);toast('Conversation copied to clipboard.')}catch{toast('Clipboard permission unavailable.')}}
function enterLibrary(){if(!state.summary.size){show('welcome');return}state.selected=null;show('library');renderSidebar();query();toggleSidebar(false)}
function openPicker(){if(state.loading)return;$('file-input').click()}
for(const id of ['new-import','top-import','library-settings'])$(id).addEventListener('click',openPicker);
$('pick-file').onclick=e=>{e.stopPropagation();openPicker()};$('pick-folder').onclick=e=>{e.stopPropagation();$('folder-input').click()};
$('file-input').onchange=async e=>{const files=addFiles([...e.target.files]);e.target.value='';await importFiles(files)};
$('folder-input').onchange=async e=>{const files=addFiles([...e.target.files]);e.target.value='';await importFiles(files)};
$('drop-zone').onclick=e=>{if(e.target.closest('button'))return;openPicker()};$('drop-zone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openPicker()}};
let dragDepth=0;document.addEventListener('dragenter',e=>{if(e.dataTransfer?.types?.includes('Files')){dragDepth++;$('drop-zone').classList.add('dragover')}});
document.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('drop-zone').classList.remove('dragover')});
document.addEventListener('dragover',e=>{if(e.dataTransfer?.types?.includes('Files'))e.preventDefault()});
document.addEventListener('drop',async e=>{if(e.dataTransfer?.files?.length){e.preventDefault();dragDepth=0;$('drop-zone').classList.remove('dragover');await importFiles(await droppedFiles(e))}});
for(const id of ['top-theme','side-theme'])$(id).onclick=toggleTheme;
$('mobile-toggle').onclick=()=>toggleSidebar(!$('sidebar').classList.contains('open'));
$('close-sidebar').onclick=()=>toggleSidebar(false);$('scrim').onclick=()=>toggleSidebar(false);
$('search-focus').onclick=()=>{enterLibrary();$('search').focus()};$('back-to-library').onclick=enterLibrary;
$('copy-chat').onclick=copyChat;
$('all-branches').onchange=e=>{state.showAllBranches=e.target.checked;requestDetail()};
$('loading-cancel').onclick=()=>{state.importCancelled=true;if(state.worker._pending){state.worker._pending.resolve({error:"cancelled"});state.worker._pending=null}state.worker.terminate();loading(false);state.summary.clear();state.assets.clear();state.assetNames.clear();state.missingIds.clear();state.selected=null;installWorker();show('welcome');toast('Import cancelled. Nothing was saved or uploaded.')};
$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(query,110)};
for(const id of ['date-filter','type-filter','sort'])$(id).onchange=query;
$('load-more').onclick=()=>{state.visible+=60;renderLibraryResults()};
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();enterLibrary();$('search').focus()}else if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){e.preventDefault();enterLibrary();$('search').focus()}else if(e.key==='Escape'){toggleSidebar(false);if(document.activeElement===$('search'))$('search').blur()}});
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
