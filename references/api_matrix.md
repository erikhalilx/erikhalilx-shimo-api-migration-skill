# Shimo Export API Type Matrix

## API Endpoint

```
GET /lizard-api/office-gw/files/export?fileGuid={guid}&type={type}
GET /lizard-api/office-gw/files/export/progress?taskId={taskId}
```

Authentication: Cookie-based (shimo_sid), no separate token needed.

## Export Type Matrix

Source: [Navyum/chrome-extension-shimo-export](https://github.com/Navyum/chrome-extension-shimo-export)

```javascript
const EXPORT_SUPPORT_MATRIX = {
  newdoc:       ['md', 'jpg', 'docx', 'pdf'],
  modoc:        ['docx', 'wps', 'pdf'],
  mosheet:      ['xlsx'],
  presentation: ['pptx', 'pdf'],
  mindmap:      ['xmind', 'jpg'],
};

const UNSUPPORTED_TYPES = ['table', 'board', 'form'];
```

## Type Normalization

Shimo API may return different type strings; normalize before lookup:

| Original type | Normalized type |
|---|---|
| `ppt`, `pptx` | `presentation` |
| `sheet` | `mosheet` |
| `docs` | `newdoc` |
| `mindmaps` | `mindmap` |

Fallback: if no exact match, use string-contains matching:
- includes('sheet') → mosheet
- includes('ppt') → presentation
- includes('doc') → newdoc
- includes('mind') → mindmap

## Export Flow

1. `GET /lizard-api/office-gw/files/export?fileGuid={guid}&type={type}`
   → Returns `{ data: { taskId } }`

2. Poll `GET /lizard-api/office-gw/files/export/progress?taskId={taskId}` every 2s
   → Returns `{ data: { progress, downloadUrl, status } }`
   → When `downloadUrl` is non-empty, export is complete

3. Download file from `downloadUrl` via Node.js https (CORS blocks browser fetch)
   → Must include Cookie header + Referer: https://shimo.im/

## Export Duration

- Small files (<5MB): 2-10 seconds
- Medium files (5-50MB): 10-60 seconds
- Large files (50-500MB): 1-10 minutes
- Very large files (>500MB): 10-30 minutes (some may timeout at 5min polling limit)

## Feishu Import Mapping

| Shimo export format | Feishu import type | Feishu obj_type |
|---|---|---|
| docx | docx | docx |
| xlsx | sheet | sheet |
| pptx | file | (no direct import) |
| xmind | (preview as docx) | docx |
| pdf | file | (no direct import) |
| md | docx (via HTML) | docx |
