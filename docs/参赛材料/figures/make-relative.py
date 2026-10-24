import re

src = r'docs/参赛材料/项目介绍文档.html'
out = r'docs/参赛材料/项目介绍文档-rel.html'
text = open(src, encoding='utf-8').read()
text = re.sub(r'src="file:///[^"]*/(figures/[^"]+|images/[^"]+)"', r'src="\1"', text)
open(out, 'w', encoding='utf-8').write(text)
print('imgs', text.count('<img'), 'absolute left', text.count('file:///'))
