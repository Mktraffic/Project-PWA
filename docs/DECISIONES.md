# Decisiones

- Se usa autenticación ligera por `x-user-id`; la clave administrativa vive únicamente en `sessionStorage`.
- No se generan noticias de ejemplo: la base inicia vacía y solo permite importación desde UPTC.
- El mapa se sustituye por coordenadas y referencia textual para no cargar una librería pesada en el bundle inicial; la ubicación sigue siendo capturada y persistida.
- Se aplican App Shell precacheado, Network First para datos y Stale-While-Revalidate para tiles/imágenes; CSS e imágenes reservan espacio y el panel admin es un chunk dinámico.
- La identidad visual adopta los colores institucionales publicados por UPTC (amarillo RGB 255, 204, 41 y negro RGB 26, 26, 26), usa la familia de interfaz declarada por su portal (`Open Sans`, con alternativa local) y emplea el SVG "UPTC color" descargado desde su página oficial de identidad gráfica.
- El acceso actual es una demostración local: dos cuentas UPTC sembradas en la base permiten validar roles. Las rutas críticas verifican la sesión y el rol en servidor; para producción se debe sustituir por SSO institucional y contraseñas con hash.
