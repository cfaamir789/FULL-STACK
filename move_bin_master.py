import re

with open('backend/public/admin.html', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Extract binMasterUploadBlock
start_marker = '<!-- BinMaster Upload Card -->'
end_marker = '<!-- Bin Content Upload Card -->'

idx_start = text.find(start_marker)
idx_end = text.find(end_marker)

if idx_start == -1 or idx_end == -1:
    print('Could not find markers for binMasterUploadBlock')
    exit(1)

block_to_move = text[idx_start:idx_end].strip()

# Replace block from original location
text = text[:idx_start] + text[idx_end:]

# 2. Replace tmplSectionBins
tmpl_start_marker = '<div id="tmplSectionBins" style="display:none">'
tmpl_end_marker = '</div>\n        </div>\n\n        <div style="text-align: center; padding: 16px">'

idx_tmpl_start = text.find(tmpl_start_marker)
idx_tmpl_end = text.find(tmpl_end_marker)

if idx_tmpl_start == -1 or idx_tmpl_end == -1:
    print('Could not find markers for tmplSectionBins')
    exit(1)

new_tmpl = '<div id="tmplSectionBins" style="display:none">\n          <div style="max-width: 800px; margin: 0 auto;">\n' + block_to_move + '\n          </div>'

text = text[:idx_tmpl_start] + new_tmpl + text[idx_tmpl_end:]

with open('backend/public/admin.html', 'w', encoding='utf-8') as f:
    f.write(text)

print('Successfully moved!')
