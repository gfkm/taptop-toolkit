# Import contract

The user selects one version-2 JSON. Its embedded assets are Base64 bytes with MIME type, byte length, and SHA-256; image nodes reference an asset stable key. The extension validates before it uploads, uploads one asset at a time, inserts only after all uploads succeed, confirms the inserted root, then saves a local receipt.

A receipt may contain destination root and media IDs. A reusable package must never contain them. Do not claim an import works without a live disposable-project receipt.
