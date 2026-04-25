import re

with open('backend/public/admin.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

out = []
blockLines = []
in_block = False

for line in lines:
    if '<!-- BinMaster Upload Card -->' in line:
        in_block = True
    
    if in_block:
        if '<!-- Bin Content Upload Card -->' in line:
            in_block = False
            out.append(line)
        else:
            blockLines.append(line)
    else:
        out.append(line)

final_out = []
in_tmpl_bins = False
for line in out:
    if '<div id="tmplSectionBins" style="display:none">' in line:
        in_tmpl_bins = True
        final_out.append(line)
        for block_line in blockLines:
            final_out.append(block_line)
        continue
        
    if in_tmpl_bins:
        if '<div style="text-align: center; padding: 16px">' in line:
            in_tmpl_bins = False
            final_out.append('        </div>\n')
            final_out.append('        </div>\n\n')
            final_out.append(line)
    else:
        final_out.append(line)

with open('backend/public/admin.html', 'w', encoding='utf-8') as f:
    f.writelines(final_out)

print('done')
