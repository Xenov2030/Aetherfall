# Tu Google Drive como nube central

Decisión elegida: los originales y respaldos se guardan en **tu cuenta de Drive**, en `Aetherfall/Archivos` y `Aetherfall/Respaldos`. PostgreSQL conserva fichas, permisos, revelaciones e historial. No se usa Drive como base de datos ni se pide a cada jugador conectar una cuenta.

**Estado:** el adaptador y los comandos están implementados. Tu cuenta no está autorizada todavía: no se crearon carpetas ni se subieron archivos reales. Las pruebas automáticas del adaptador usan un transporte controlado, no tu cuenta.

## Autorizar tu cuenta una vez

Este paso necesita tu consentimiento de Google. La conexión de Google Drive que puedas tener dentro de ChatGPT no concede permisos a una aplicación desplegada en Vercel.

1. En [Google Cloud Console](https://console.cloud.google.com/), creá o elegí un proyecto de Aetherfall y habilitá **Google Drive API**. No hace falta crear una cuenta de servicio: usaremos tu cuenta de usuario.
2. Configurá la pantalla de consentimiento de **Google Auth Platform**. Para una cuenta personal, configurá el público externo y tu cuenta como usuario de prueba mientras preparás la aplicación. Solicitá exclusivamente `https://www.googleapis.com/auth/drive.file`, que permite gestionar archivos creados o autorizados para esta aplicación; no acceso completo a tu Drive. Usá un cliente dedicado a Aetherfall.
3. Creá un **cliente OAuth de aplicación de escritorio**. Guardá su ID y secreto en `.env.local`, en tu computadora, con estos nombres:

   ```dotenv
   GOOGLE_DRIVE_CLIENT_ID=
   GOOGLE_DRIVE_CLIENT_SECRET=
   ```

   No pegues sus valores en el chat ni los subas a Git. No hacen falta tarjeta, cuenta de servicio ni claves de facturación para que el código pueda iniciar este flujo; revisá los requisitos que muestre Google para tu cuenta antes de aceptar cambios o servicios adicionales.

4. En **tu propia computadora**, con el proyecto y Node.js 24 instalados:

   ```sh
   npm ci
   npm run drive:authorize
   ```

   Abrí la dirección de consentimiento que muestra el comando en el navegador **de esa misma computadora**. Elegí tu cuenta y autorizá Aetherfall. El receptor escucha solo en `127.0.0.1:53682`, valida estado y PKCE, y vence a los cinco minutos. No ejecutes este paso en una máquina de nube si tu navegador no puede alcanzar su loopback. No se publican enlaces localhost como vistas previas web.

   El comando usa la biblioteca OAuth oficial de Google, verifica el alcance concedido y guarda la autorización renovable en `.env.local` con permisos privados. No muestra el token en consola ni lo envía al navegador. Si ya hay una autorización, exige `--reconectar` para reemplazarla explícitamente.

5. Prepará la estructura:

   ```sh
   npm run drive:setup
   ```

   Crea dos carpetas privadas dentro de una carpeta nueva Aetherfall. Guarda los identificadores en `.env.local`. Si ya están configuradas, verifica las existentes en lugar de duplicarlas. No comparte carpetas ni originales con jugadores.

6. Reiniciá el servidor de desarrollo para que lea los cambios. En **Campaña → Tu nube**, usá **Comprobar mi Drive**. La comprobación verifica que ambas carpetas sean tuyas, privadas, no estén en la papelera y admitan escritura; no prueba por sí sola todas las operaciones de subida y respaldo.

## Variables del servidor en Vercel

Copiá desde tu configuración local al panel seguro de variables del proyecto, sin pasar por el chat:

| Variable                       | Uso                                 |
| ------------------------------ | ----------------------------------- |
| STORAGE_PROVIDER=drive         | Activa Drive para archivos nuevos   |
| GOOGLE_DRIVE_CLIENT_ID         | Cliente OAuth dedicado              |
| GOOGLE_DRIVE_CLIENT_SECRET     | Secreto del cliente                 |
| GOOGLE_DRIVE_REFRESH_TOKEN     | Autorización renovable de tu cuenta |
| GOOGLE_DRIVE_FILES_FOLDER_ID   | Carpeta privada de originales       |
| GOOGLE_DRIVE_BACKUPS_FOLDER_ID | Carpeta privada de respaldos        |

Las credenciales solo se utilizan en el servidor. No se guardan en PostgreSQL ni en el frontend. El sistema no toma automáticamente credenciales de Google Cloud del entorno: necesita tu autorización explícita de usuario.

Conservá por separado `DATABASE_URL`, autenticación de Aetherfall y SMTP. Drive reemplaza el almacenamiento S3 para archivos nuevos, **no PostgreSQL ni el correo de acceso**. No se necesitan credenciales S3 salvo para leer originales anteriores que ya estén allí. No configures `AETHERFALL_LOCAL=1` en Vercel.

En este entorno de nube se solicitaron en el borrador de configuración los destinos `oauth2.googleapis.com` y `www.googleapis.com`; hasta que se guarde y aplique esa configuración, la política de red puede impedir la conexión. La autorización inicial se hace en tu computadora. Vercel tiene su propia configuración de red y variables.

## Privacidad y funcionamiento

- Los jugadores descargan a través de Aetherfall después de verificar su campaña y personaje. No reciben el ID de Drive, credenciales ni un enlace público de Google.
- Una descarga nueva requiere permisos vigentes. Retirar acceso no borra copias ya descargadas.
- Compartir, mover o borrar archivos directamente en Drive puede dejar el original indisponible. Si una carpeta o archivo fue compartido en Drive, el adaptador lo rechaza. Esto no puede deshacer accesos que el dueño haya concedido por fuera de Aetherfall: mantené estas carpetas privadas.
- El servidor comprueba que el archivo esté en la carpeta esperada y tenga la marca de Aetherfall. Antes de entregarlo compara tamaño y SHA-256 con el original registrado: una edición externa no se publica silenciosamente.
- Se conserva el nombre y los bytes del original. Se admiten hasta 10 MB por archivo; la interfaz envía las cargas grandes en partes y el servidor conserva el original completo en Drive.
- Las referencias antiguas locales/S3 se conservan; cambiar proveedor no borra ni mueve nada automáticamente. Un respaldo con originales puede restaurarse en otro almacenamiento y reasigna las referencias al destino.

## Respaldos en Drive

Desde Campaña, **Guardar respaldo en mi Drive** crea una copia con los datos accesibles al máster y los originales. No incluye borradores personales de jugadores que no te hayan compartido. Está sujeto a límites de memoria/duración de la función; para campañas grandes usá el comando administrativo.

Con credenciales de servidor y permiso de máster:

```sh
npm run backup:drive -- UUID_CAMPAÑA UUID_MÁSTER
```

Ese respaldo administrativo incluye la campaña completa, también borradores personales para recuperación de desastre, y se guarda en tu carpeta privada Respaldos. Contiene información sensible: no lo compartas. No hay ejecución automática ni eliminación de copias anteriores.

Para restaurar, descargá el JSON desde tu Drive privado y seguí [respaldo y restauración](respaldo.md) usando una base aislada y las variables del almacenamiento de destino. Los originales están incluidos dentro del respaldo; no depende de que los archivos de origen sigan disponibles.

## Cuotas y mantenimiento

Los archivos y cada respaldo consumen el espacio disponible de tu cuenta Google. El adaptador no contrata Google One, no aumenta cuotas ni asegura almacenamiento ilimitado. La aplicación tampoco evita límites temporales de la API, revocaciones, políticas de una cuenta Workspace o caducidad de la autorización. Revisá en Google el estado de publicación de tu cliente OAuth: una configuración en modo prueba puede requerir renovar autorización y no debe asumirse permanente.

Una vez configurado, verificar en un entorno de pruebas separado: subir un archivo ficticio, verlo con un jugador autorizado, rechazar otro jugador, retirar acceso, guardar un respaldo y restaurarlo en una base aislada. **Estas comprobaciones contra tu Drive real siguen pendientes** hasta que autorices la cuenta.

## Fuentes oficiales consultadas

- [Biblioteca OAuth oficial de Google](https://github.com/googleapis/google-auth-library-nodejs#oauth2), renovación, consentimiento offline y PKCE.
- [Documento oficial de descubrimiento de Drive v3](https://github.com/googleapis/google-api-nodejs-client/blob/main/discovery/drive-v3.json), alcance `drive.file`, subida multipart y metadatos `ownedByMe`, `shared`, `parents`, `appProperties` y `size`.
- [Muestras oficiales de Google Workspace](https://github.com/googleworkspace/node-samples/tree/main/drive), subida de originales.

Se verificaron estas fuentes en GitHub. No se afirman precios o cuotas numéricas actuales de una cuenta a la que todavía no se tiene acceso.

## Asistente portátil para Windows

También está disponible el código de `scripts/drive-desktop-helper.ts`, empaquetable con la biblioteca oficial de Google. El asistente busca el JSON de escritorio en su misma carpeta, abre Google con PKCE, recibe el consentimiento en loopback y crea las carpetas privadas. Guarda `Aetherfall-Drive-Servidor.env` únicamente en la computadora del usuario; nunca imprime el token ni lo envía a este chat. Ese archivo debe cargarse en el panel privado de variables del servidor. El paquete distribuido no contiene credenciales. Requiere Node.js LTS y no modifica ni despliega Vercel.
