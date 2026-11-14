# Writes the weights of two aim models as hex strings in a TypeScript file (a module has no file system and no atob).
# Usage: python3 -I genweights.py <out.ts> <model>...   (models are under /tmp/rec/models)
import json, sys
out = sys.argv[1]
parts = []
for i, name in enumerate(sys.argv[2:]):
    meta = json.load(open('/tmp/rec/models/' + name + '.json'))
    raw = open('/tmp/rec/models/' + name + '.bin', 'rb').read()
    parts.append("  { name: %s, sizes: %s, nc: %d, nb: %d, edges: %s, hex: '%s' }," % (json.dumps(name), json.dumps(meta['sizes']), meta['nc'], meta['nb'], json.dumps(meta['edges']), raw.hex()))
open(out, 'w').write("// GENERATED (lab only): aim model weights as hex.\nexport const MODELS = [\n" + "\n".join(parts) + "\n];\n")
print('wrote', out, len(parts), 'models')
