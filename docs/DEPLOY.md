# Despliegue HTTPS

Rápido: ejecuta `cloudflared tunnel --url http://localhost:3000` (o `ngrok http 3000`). Estable: crea un servicio en Render, Railway o Fly.io, usa `npm start` y configura las variables de `.env` en el panel. Los discos gratuitos pueden ser efímeros y el primer acceso tras suspensión tarda: llama a `/api/health` antes de medir.
