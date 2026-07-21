import re

with open('dashboard.ts', 'r') as f:
    content = f.read()

content = content.replace("declare global {\n    interface Window", "interface Window")
content = content.replace("    }\n}\n", "}\n")

# e.target
content = re.sub(r'e\.target\.value', r'(e.target as HTMLInputElement).value', content)
content = re.sub(r'document\.getElementById\((.*?)\)\.disabled', r'(document.getElementById(\1) as HTMLButtonElement).disabled', content)

# implicit any
content = re.sub(r'function handleCredentialResponse\(response\)', r'function handleCredentialResponse(response: any)', content)
content = re.sub(r'function renderSingleAssetChart\(ticker\)', r'async function renderSingleAssetChart(ticker: string)', content)
content = re.sub(r'async function renderSingleAssetChart\(ticker\)', r'async function renderSingleAssetChart(ticker: string)', content)

# Write back
with open('dashboard.ts', 'w') as f:
    f.write(content)
