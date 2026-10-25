"""Build an offline single-file edition without external dependencies."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
html=(root/'index.html').read_text()
css=(root/'styles.css').read_text()
zipjs=(root/'zip.js').read_text().replace('export async function openZip','async function openZip').replace('export function signatureMime','function signatureMime')
app=(root/'app.js').read_text().replace("import {openZip,signatureMime} from './zip.js';",'')
app=app.replace("const worker=new Worker('./parser.worker.js');", "const worker=new Worker(URL.createObjectURL(new Blob([document.getElementById('worker-code').textContent],{type:'text/javascript'})));")
worker=(root/'parser.worker.js').read_text()
for s in (css,zipjs,app,worker):
    assert not re.search(r'<\s*/\s*script',s,re.I),'Source may prematurely terminate inline script'
html=html.replace('<link rel="stylesheet" href="./styles.css" />',f'<style>\n{css}\n</style>')
html=html.replace('<script type="module" src="./app.js"></script>',f'<script type="text/plain" id="worker-code">\n{worker}\n</script>\n<script>\n{zipjs}\n{app}\n</script>')
html=html.replace('<link rel="manifest" href="./manifest.webmanifest" />','')
html=html.replace('<link rel="icon" href="./icon.svg" type="image/svg+xml" />','')
# Opening a file:// page should not attempt to install a service worker.
(root/'ChatGPTBackup-Standalone.html').write_text(html)
print(root/'ChatGPTBackup-Standalone.html')
