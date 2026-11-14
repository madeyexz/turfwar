import sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
STUB = """<!doctype html><html><head><meta charset="utf-8"><style>
:root{--background:#fff;--foreground:#1a1a1a;--muted-foreground:#6b6b6b;--border:#d9d9d9;--grid:#ececec;--card:#fafafa;--muted:#f0f0f0;
--chart-1:#2f6fed;--chart-2:#d9730d;--chart-3:#2a9d6f;--chart-context:#a8a8a8;--link:#2f6fed;--radius:8px;
--font-sans:system-ui,sans-serif;--font-mono:ui-monospace,monospace}
html.dark{--background:#161616;--foreground:#ededed;--muted-foreground:#9a9a9a;--border:#3a3a3a;--grid:#262626;--chart-context:#6a6a6a;--chart-1:#6ea1ff;--chart-2:#f0994a}
body{margin:0;background:var(--background);color:var(--foreground);font:13px/20px var(--font-sans)}
.ui-header{margin-bottom:16px}.ui-title{font-size:13px;font-weight:500;margin:0;text-wrap:balance}.ui-sub{font-size:12px;color:var(--muted-foreground);margin:0}
.ui-caption{font-size:11px;line-height:16px;color:var(--muted-foreground);margin:0}
#wrap{padding:12px}
</style></head><body CLASS><div id="wrap" style="width:WIDTHpx;box-sizing:content-box">BODY</div></body></html>"""
for name in ('aim','closed','move','trade'):
    body = open(os.path.join(HERE,'out',name+'.html')).read()
    for w in (720, 360):
        open(os.path.join(HERE,'out','t-%s-%d.html'%(name,w)),'w').write(STUB.replace('WIDTH',str(w)).replace('BODY',body).replace('CLASS',''))
print('ok')
