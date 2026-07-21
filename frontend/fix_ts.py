import re

with open('dashboard.ts', 'r') as f:
    content = f.read()

# Add declarations at top
declarations = """declare var Chart: any;
declare global {
    interface Window {
        autoRefreshTimer: any;
        refreshMinutes: number;
        handleCredentialResponse: any;
    }
}

"""
if "declare var Chart" not in content:
    content = declarations + content

# Fix standard types for implicitly any variables in maps/filters
content = re.sub(r'\(tab => \{', r'((tab: HTMLElement) => {', content)
content = re.sub(r'tab\.dataset\.view', r'(tab as HTMLElement).dataset.view', content)

content = re.sub(r'document\.getElementById\((.*?)\)\.style', r'(document.getElementById(\1) as HTMLElement).style', content)
content = re.sub(r'document\.getElementById\((.*?)\)\.textContent', r'(document.getElementById(\1) as HTMLElement).textContent', content)
content = re.sub(r'document\.getElementById\((.*?)\)\.value', r'(document.getElementById(\1) as HTMLInputElement).value', content)
content = re.sub(r'document\.getElementById\((.*?)\)\.innerHTML', r'(document.getElementById(\1) as HTMLElement).innerHTML', content)
content = re.sub(r'document\.getElementById\((.*?)\)\.addEventListener', r'(document.getElementById(\1) as HTMLElement).addEventListener', content)
content = re.sub(r'document\.getElementById\((.*?)\)\.getContext', r'(document.getElementById(\1) as HTMLCanvasElement).getContext', content)

# Fix some implicit anys in callbacks
content = re.sub(r'forEach\(h => \{', r'forEach((h: any) => {', content)
content = re.sub(r'forEach\(t => \{', r'forEach((t: any) => {', content)
content = re.sub(r'filter\(h =>', r'filter((h: any) =>', content)
content = re.sub(r'filter\(t =>', r'filter((t: any) =>', content)
content = re.sub(r'map\(h =>', r'map((h: any) =>', content)
content = re.sub(r'map\(d =>', r'map((d: any) =>', content)
content = re.sub(r'map\(\(\_, i\)', r'map((_: any, i: number)', content)

# Write back
with open('dashboard.ts', 'w') as f:
    f.write(content)
