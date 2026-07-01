# Feishu Upload Strategies

This project uses Feishu OAuth `user_access_token`. Files and folders are created as the currently authorized user, not as a bot or tenant application owner.

Do not commit real `app_id`, `app_secret`, access tokens, refresh tokens, folder tokens, cookies, or migration reports.

## Strategy Selection

| File size | Strategy | API | Result |
|---|---|---|---|
| ≤ 20MB | Direct import | `medias/upload_all` + `import_tasks` | Online document if import succeeds; otherwise cloud drive file |
| > 20MB | Chunked upload + import task | `files/upload_prepare` + `upload_part` + `upload_finish` + `import_tasks` | Online document if import succeeds |
| > 20MB (import fails) | Chunked upload as cloud file | `files/upload_prepare` + `upload_part` + `upload_finish` | Cloud drive file |
| Fallback | Create docx + add text/PDF/screenshot references | `docx/v1/documents` + docx block APIs | Fallback Feishu document with original Shimo link |

## Direct Import (≤ 20MB)

```text
POST /drive/v1/medias/upload_all
Authorization: Bearer {user_access_token}
Content-Type: multipart/form-data; boundary={boundary}

Fields:
  file_name: "name.xlsx"
  parent_type: "ccm_import_open"
  size: {file_size}
  parent_node: {folder_token}
  extra: {"obj_type":"sheet","file_extension":"xlsx"}
  file: (binary)
```

Response: `{ code: 0, data: { file_token } }`

After upload, call `POST /drive/v1/import_tasks` to convert the uploaded file to a Feishu online document.

## Chunked Upload (> 20MB)

### Step 1: Prepare

```text
POST /drive/v1/files/upload_prepare
Authorization: Bearer {user_access_token}
Content-Type: application/json

Body: {
  "file_name": "name.xlsx",
  "parent_type": "explorer",
  "parent_node": "{folder_token}",
  "size": {file_size}
}
```

Response: `{ code: 0, data: { upload_id } }`

Block size: fixed 4MB.

### Step 2: Upload each block

```text
POST /drive/v1/files/upload_part
Authorization: Bearer {user_access_token}
Content-Type: multipart/form-data; boundary={boundary}

Fields:
  upload_id: "{upload_id}"
  seq: {block_index}
  size: {block_size}
  file: (binary)
```

Response: `{ code: 0, data: { block_token } }`

### Step 3: Finish

```text
POST /drive/v1/files/upload_finish
Authorization: Bearer {user_access_token}
Content-Type: application/json

Body: {
  "upload_id": "{upload_id}",
  "block_num": {total_blocks}
}
```

Response: `{ code: 0, data: { file_token } }`

### Step 4: Create import task

```text
POST /drive/v1/import_tasks
Authorization: Bearer {user_access_token}
Content-Type: application/json

Body: {
  "file_extension": "xlsx",
  "file_token": "{file_token}",
  "type": "sheet",
  "file_name": "name",
  "point": {
    "mount_type": 1,
    "mount_key": "{folder_token}"
  }
}
```

Response: `{ code: 0, data: { ticket } }`

Poll result:

```text
GET /drive/v1/import_tasks/{ticket}
Authorization: Bearer {user_access_token}
```

- `job_status = 0`: success
- `job_status = 1` or `2`: failed
- `job_status = 3`: in progress

## OAuth Credentials

Users must create their own Feishu app and put credentials in `migration.config.json`:

```json
{
  "feishu": {
    "app_id": "cli_xxx",
    "app_secret": "your_app_secret"
  }
}
```

The tool exchanges the local OAuth callback code for `user_access_token` and `refresh_token`; token cache is stored under the configured `.cache/` directory and must not be committed.

## Folder Creation

```text
POST /drive/v1/files/create_folder
Authorization: Bearer {user_access_token}
Content-Type: application/json

Body: {
  "name": "folder_name",
  "folder_type": "normal",
  "folder_token": "{parent_token_or_empty}"
}
```

Duplicate name errors may be returned when a same-name folder exists. The migration code should either reuse a user-provided target folder token or create a new migration root with a unique name.

## Docx Fallback

Create an empty docx in the target folder:

```text
POST /docx/v1/documents
Authorization: Bearer {user_access_token}
Content-Type: application/json

Body: {
  "folder_token": "{folder_token}",
  "title": "Fallback - original title"
}
```

Then create child blocks under the root block whose `block_id` is the document id:

```text
POST /docx/v1/documents/{document_id}/blocks/{document_id}/children?document_revision_id=-1
Authorization: Bearer {user_access_token}
Content-Type: application/json

Body: {
  "index": -1,
  "children": [
    {
      "block_type": 2,
      "text": {
        "elements": [
          { "text_run": { "content": "Original Shimo link: https://shimo.im/..." } }
        ]
      }
    }
  ]
}
```

## Rate Limiting

- Feishu API: exponential backoff for HTTP 429 and known token/rate-limit errors.
- Upload blocks: small delay between blocks.
- Import task polling: 2s interval.
- Folder/document creation in the same parent folder should remain serial.
