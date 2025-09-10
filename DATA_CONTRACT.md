# Data Contract

Este documento define la estructura de los datos intercambiados entre el backend (Cloud Functions) y los frontends (client-app, admin-app).

## User
```json
{
  "uid": "string",
  "email": "string",
  "displayName": "string",
  "role": "admin" | "client"
}
```

## Report
```json
{
  "id": "string",
  "title": "string",
  "createdBy": "string (uid)",
  "createdAt": "timestamp",
  "data": "object"
}
```
