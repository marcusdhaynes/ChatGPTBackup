import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const start=source.indexOf('function safeExternalHref(');
const end=source.indexOf('function markdown(md){',start);
assert.ok(start>0&&end>start,'Expected live archive link formatter was not found');
const context={URL};
vm.createContext(context);
vm.runInContext(
 "const escaped=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));\n"+
 source.slice(start,end)+"\nthis.formatInline=formatInline;this.safeExternalHref=safeExternalHref;",
 context
);
const {formatInline,safeExternalHref}=context;
const expected='href="https://openclaw.ai/"';
function linkWorks(input,label='OpenClaw'){
 const result=formatInline(input);
 assert.ok(result.includes(expected),'Did not render clickable OpenClaw link: '+result);
 assert.ok(result.includes('>'+label+'</a>'),'Incorrect link title: '+result);
 assert.ok(result.includes('target="_blank" rel="noopener noreferrer"'),'Unsafe external navigation: '+result);
 assert.ok(!result.includes('&lt;Link'),'Displayed an unrendered Link tag: '+result);
 return result;
}
const backtick=String.fromCharCode(96);
linkWorks('**\\<Link url="[https://openclaw.ai](https://openclaw.ai)" title="OpenClaw"/>**');
linkWorks('<Link url="https://openclaw.ai" title="OpenClaw"/>');
linkWorks('<Link url="https://openclaw.ai">OpenClaw</Link>');
linkWorks('[OpenClaw](https://openclaw.ai)');
linkWorks('https://openclaw.ai','https://openclaw.ai');
linkWorks('Read https://openclaw.ai.','https://openclaw.ai');
const bold=linkWorks('**\\<Link url="https://openclaw.ai" title="OpenClaw"/>**');
assert.match(bold,/<strong><a href="https:\/\/openclaw.ai\/"/);
assert.match(bold,/<\/a><\/strong>/);
const plain=formatInline('Read [documentation](https://example.com/doc?q=1&lang=en)');
assert.match(plain, /href="https:\/\/example.com\/doc\?q=1&amp;lang=en"/);
assert.match(plain, />documentation<\/a>/);
assert.match(formatInline('[Parentheses](https://en.wikipedia.org/wiki/Function_(mathematics))'),/href="https:\/\/en.wikipedia.org\/wiki\/Function_\(mathematics\)"/);
assert.ok(!formatInline(backtick+'<Link url="https://openclaw.ai" title="OpenClaw"/>'+backtick).includes('<a href='));
assert.ok(!formatInline(backtick+'https://openclaw.ai'+backtick).includes('<a href='));
assert.equal(safeExternalHref('javascript:alert(1)'),null);
const invalid=formatInline('<Link url="javascript:alert(1)" title="Unsafe"/>');
assert.ok(!invalid.includes('<a href='));
assert.ok(invalid.includes('&lt;Link'));
const injected=formatInline('<Link url="https://openclaw.ai" title="<img src=x onerror=alert(1)>"/>');
assert.ok(!injected.includes('<img'));
assert.ok(!formatInline('<script>alert(1)</script>').includes('<script>'));
console.log('Clickable ChatGPT links, Markdown URLs, safe schemes and code spans: passed.');
