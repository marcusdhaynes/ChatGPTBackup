"""Generate synthetic ChatGPT-like archive fixtures for manual browser tests."""
from pathlib import Path
import json, zipfile, struct, zlib
ROOT=Path(__file__).resolve().parent


def node(mid, role, parts, parent=None, dt=1710000000, attachments=None):
    return {"id":mid,"parent":parent,"children":[],"message":{"id":mid,"author":{"role":role},"create_time":dt,"content":{"content_type":"multimodal_text","parts":parts},"metadata":{"attachments":attachments or []}}}

def conv(cid,title,with_media=False):
    nodes={
      "u1":node("u1","user",["Please explain the difference between .dat and JSON backup files."],dt=1710000000),
      "a1":node("a1","assistant",["**JSON** contains text. **DAT** can contain images or sound.\n\n```python\nprint('archive works')\n```\n\n| Format | Content |\n| --- | --- |\n| JSON | conversations |\n| DAT | binary media |"],parent="u1",dt=1710000010),
      "u2":node("u2","user",["Here are my attachments",{"content_type":"image_asset_pointer","asset_pointer":"sediment://file_IMG123", "file_name":"my-chart.png"},"And a missing paper:",{"content_type":"file","asset_pointer":"file-service://file_MISSINGPDF", "file_name":"research-paper.pdf"}],parent="a1",dt=1710000030),
      "a2":node("a2","assistant",["The images appear in place, and missing files retain a slot. Here is a link [Example](https://example.com)."],parent="u2",dt=1710000050),
      "a2b":node("a2b","assistant",["This is an alternate answer branch."],parent="u2",dt=1710000040),
    }
    for n in nodes.values():
        if n['parent'] in nodes:nodes[n['parent']]['children'].append(n['id'])
    if not with_media:
        nodes['u2']['message']['content']['parts']=['A plain text conversation without extra media.']
    return {"id":cid,"conversation_id":cid,"title":title,"create_time":1710000000,"update_time":1710000050,"current_node":"a2","mapping":nodes}

def make_png():
    def chunk(typ,data):return struct.pack('>I',len(data))+typ+data+struct.pack('>I',zlib.crc32(typ+data)&0xffffffff)
    pixels=b''.join(b'\0'+bytes((25,160,126))*64 for _ in range(32))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',64,32,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b'')

def get_media_zip():
    import io
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('file-IMG123.dat',make_png())
    return out.getvalue()

if __name__=='__main__':
    inner=ROOT/'sample-conversations.zip'
    with zipfile.ZipFile(inner,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('conversations-000.json',json.dumps([conv('sample-1','Test: multimedia & missing files',True),conv('sample-2','Thoughts about a novel')]))
    sample=ROOT/'sample-export.zip'
    with zipfile.ZipFile(sample,'w',zipfile.ZIP_DEFLATED) as z:
        z.write(inner,'Conversations__demo-part-001.zip')
        z.writestr('Files__demo-files-001.zip',get_media_zip())
    print(sample)

