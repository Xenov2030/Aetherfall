# API e integración opcional

Base de negocio: `/api/campaigns/{campaignId}`. Sesión Auth.js para la aplicación o `Authorization: Bearer <credencial>` para una integración creada explícitamente por el máster. Nunca incluir la credencial en parámetros de URL ni compartirla en el chat.

La aplicación comprueba membresía activa y campaña en cada solicitud. Las cookies requieren un origen exacto en operaciones de escritura, además de la protección de Auth.js en login. Las credenciales Bearer tienen scopes y límite de 60 solicitudes/minuto. Las escrituras de usuario, accesos por correo, subidas y exportaciones tienen límites persistentes adicionales.

## API de preparación externa

| Método y ruta              | Scope   | Comportamiento                                                                                                             |
| -------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET `/records?q=texto`     | read    | Busca solo dentro de la campaña concedida; incluye el archivo privado del máster                                           |
| GET `/records/{id}`        | read    | Contenido, fragmentos, historial y metadatos de archivos del registro                                                      |
| POST `/records`            | draft   | Crea una entrada privada, siempre `borrador`; no crea fichas ni publica                                                    |
| PATCH `/records/{id}`      | draft   | Edita únicamente un borrador, con `version` esperada                                                                       |
| POST `/folders`            | folders | Crea carpeta; `name`, `parent_id` opcional                                                                                 |
| POST `/records/{id}/links` | folders | Vincula `target_id` de la misma campaña; no concede acceso                                                                 |
| POST `/attachments`        | files   | Multipart `record_id`, `file`; original privado, sin `fragment_id`                                                         |
| GET `/attachments/{id}`    | files   | Autoriza y devuelve original servido con autorización para Drive/desarrollo local, o redirección S3 firmada de 60 segundos |

Las credenciales de integración **no** pueden revelar, retirar revelaciones, administrar miembros, mandar correspondencia, comerciar, exportar, crear otras credenciales o acceder a otra campaña. `read` debe concederse solo si se acepta exponer el archivo privado a esa herramienta. `draft` no concede lectura general.

Ejemplo de cuerpo de creación (la autenticación va en un encabezado del cliente configurado de forma segura):

```json
{
  "kind": "idea",
  "title": "Evolución futura de la reliquia",
  "body": "Texto recibido y revisable",
  "status": "borrador",
  "folder_id": null,
  "data": { "tags": ["por revisar"] }
}
```

Actualización con control de versiones:

```json
{ "version": 3, "title": "Resumen revisado", "body": "Nuevo texto privado" }
```

409 indica que otra edición cambió la versión; leer y reconciliar antes de reintentar. No sobreescribir a ciegas. Los adjuntos con igual SHA-256, registro y visibilidad se detectan como duplicados. Las creaciones de texto no tienen deduplicación por contenido: una herramienta debe conservar el ID devuelto y actualizarlo, no repetir POST indiscriminadamente. Las transferencias, entregas, ajustes y solicitudes de compra usan claves de idempotencia UUID únicas y bloqueadas en PostgreSQL.

Respuestas: 400 validación; 401 autenticación; 403 permiso/CSRF/scope; 404 contenido no disponible; 409 conflicto/stock/saldo; 413 tamaño; 429 límite. Los detalles privados de errores del proveedor no se devuelven al navegador.

## API de la aplicación

`overview`, `records`, `fragments/{id}`, `folders`, `members/{user}`, `invitations`, `proposals`, `journals`, `threads`, `commerce`, `rolls`, `export` e `integrations`. Los clientes externos no reciben acceso a estas rutas por tener una sesión en ChatGPT; los scopes anteriores son la lista explícita de operaciones autorizadas para tokens.

- Revelación: POST `/fragments/{id}` con `characters`, `source` y `revoke` opcional; solo máster.
- Ficha: PATCH `/records/{id}`, con versión y lista de campos permitidos; propietario o máster.
- Bitácoras: POST `/journals` guarda privado; PATCH `/{id}` aplica versión, texto y destinatarios explícitos; solo autor.
- Correspondencia: POST `/threads` crea borrador o envía explícitamente; POST `/{id}/send`; POST `/{id}/reply`; lectura filtrada por destinatario.
- Comercio: `/commerce/products`, `/catalog/{id}`, `/purchases`, `/purchases/{id}`, `/wallets`, `/inventory` y `/inventory/{id}`. Solo el máster confirma o mueve propiedades. Dinero como cadenas enteras en unidades base.

## Evaluación de ChatGPT y MCP

Se consultaron las fuentes oficiales de [Apps SDK de OpenAI](https://github.com/openai/openai-apps-sdk-examples) y [autorización HTTP de MCP](https://github.com/modelcontextprotocol/specification/blob/main/docs/specification/2025-11-25/basic/authorization.mdx) el 1 de noviembre de 2026.

Un adaptador MCP remoto autenticado requiere el contrato de herramientas y transporte HTTP compatible; la especificación revisada define OAuth 2.1, descubrimiento del servidor de autorización y metadatos de recurso protegido. Un token personal de esta API **no equivale** a ese flujo OAuth ni hace que ChatGPT esté conectado. El acceso a conectores depende también de las capacidades y políticas de la cuenta ChatGPT.

No se implementó ni publicó un servidor MCP/OAuth incompleto. La API está separada del núcleo y puede usarse por un cliente autorizado; el adaptador MCP queda como módulo opcional posterior, con proveedor OAuth y verificación de compatibilidad del cliente elegidos explícitamente. Un transporte HTTP sin estado puede ser compatible con funciones de Vercel; no se afirma que haga falta otro alojamiento sin medir sus límites. No se recomienda un servidor SSE persistente como requisito del núcleo.

Las imágenes y documentos recibidos se tratan como datos, no como instrucciones. No se accede al historial del chat ni a archivos que no se hayan proporcionado. La carga manual de originales y la edición de borradores funcionan sin integración externa. Publicar o revelar seguirá requiriendo una acción explícita del máster en la aplicación.

## Drive central

GET `/storage` devuelve proveedor y presencia de configuración, sin credenciales ni IDs de Google. POST `/storage/check` verifica las carpetas privadas. POST `/storage/backup` guarda un respaldo de datos accesibles al máster. Las tres operaciones requieren sesión de máster activo; los tokens de integración y jugadores no acceden. La presencia de variables no se presenta como una conexión comprobada.

## Elección de personaje (sesión de jugador)

`GET /characters/choices` devuelve `{locked, available}`. Cada candidato contiene solo `id` y `title`. `POST /characters/{id}/claim` confirma la elección inicial. Exige membresía activa de jugador, personaje habilitado y libre de la misma campaña; serializa elecciones y reasignaciones por campaña. La elección queda registrada en auditoría e historial, incluso si luego se libera o elimina la ficha. La vista de prueba del máster y las credenciales de integración no pueden reclamar personajes. La reasignación manual sigue en `POST /records/{id}/assign`, exclusiva del máster.
