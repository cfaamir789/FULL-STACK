path = r'c:\Users\aamir\Desktop\FUL STACK\InventoryApp\src\screens\AdminScreen.js'
code = open(r'c:\Users\aamir\Desktop\FUL STACK\admin_src.txt', encoding='utf-8').read()
with open(path, 'w', encoding='utf-8') as f:
    f.write(code)
print('done', len(code))
