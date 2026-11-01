# Despliegue en Vercel

El código está preparado; **no se hizo un despliegue**. La URL que aportó el usuario no pudo inspeccionarse por una denegación de red. No se dispone de acceso al proyecto Vercel, a PostgreSQL externo, a tu Drive ni a SMTP. No se solicitaron secretos por chat ni se contrataron planes.

## Configuración externa necesaria

1. Revisar [servicios y condiciones](servicios.md). Crear o seleccionar PostgreSQL externo. Obtener una conexión con pool y TLS verificado.
2. Conectar tu Drive mediante la [guía de Google Drive](google-drive.md). OAuth de usuario con alcance `drive.file`, carpetas privadas y credenciales solo en el servidor; no hace falta activar R2.
3. Configurar SMTP autorizado para enlaces de acceso y un remitente permitido por ese proveedor. No hace falta correo para la correspondencia de campaña: es interna.
4. En Vercel, seleccionar el proyecto que administra el dominio existente, o importar el repositorio cuando estos cambios estén disponibles en GitHub. Framework Next.js, Node.js 24, instalar con `npm ci` y compilar con `npm run build`.
5. Cargar las variables en **Environment Variables** del proyecto. No poner secretos en Git, parámetros de URL, frontend ni archivos públicos.

| Variable de servidor                                          | Uso                                                                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| DATABASE_URL                                                  | PostgreSQL externo con pool y `sslmode=verify-full` o la configuración de confianza documentada por el proveedor |
| NEXTAUTH_URL                                                  | URL HTTPS exacta del entorno, sin `/` final; producción y preview usan sus propios valores                       |
| NEXTAUTH_SECRET                                               | Secreto aleatorio fuerte, diferente para producción y pruebas                                                    |
| SMTP_URL                                                      | Transporte SMTP autorizado; usar TLS y validación de certificados del proveedor                                  |
| EMAIL_FROM                                                    | Remitente autorizado                                                                                             |
| STORAGE_PROVIDER                                              | `drive`, para la nube central elegida                                                                            |
| GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET           | Cliente OAuth de escritorio dedicado a Aetherfall                                                                |
| GOOGLE_DRIVE_REFRESH_TOKEN                                    | Autorización renovable de tu cuenta de Google                                                                    |
| GOOGLE_DRIVE_FILES_FOLDER_ID / GOOGLE_DRIVE_BACKUPS_FOLDER_ID | Carpetas privadas creadas por el comando de preparación                                                          |
| S3_ENDPOINT                                                   | Endpoint HTTPS de la cuenta S3/R2                                                                                |
| S3_REGION                                                     | Región del proveedor; `auto` para R2                                                                             |
| S3_BUCKET                                                     | Nombre del bucket privado del entorno                                                                            |
| S3_ACCESS_KEY_ID                                              | Credencial restringida al bucket                                                                                 |
| S3_SECRET_ACCESS_KEY                                          | Secreto correspondiente                                                                                          |

**No configurar AETHERFALL_LOCAL=1 en Vercel.** Aunque se configure por error, el código lo deshabilita si existe `VERCEL` o si `NODE_ENV=production`. No se usa `.local` ni PGlite persistente en funciones.

Desde una terminal de administración con las variables del destino cargadas de forma segura:

```sh
npm run db:migrate
npm run bootstrap -- TU_CORREO_REAL
```

No ejecutar `bootstrap` de nuevo sobre la misma campaña. No ejecutar `db:seed` en producción real: es para una base de prueba con datos ficticios. Las migraciones no se aplican durante `next build` para que una vista previa no toque accidentalmente producción.

Para generar el secreto, usá un generador seguro local y cargalo directamente en Vercel. No lo pegues en un chat ni lo agregues a un comando registrado. La aplicación debe fallar si las credenciales faltan; no hay cuentas, almacenamiento ni login de demostración habilitados por un flag de producción.

## Entorno de pruebas por enlace

Usar un **proyecto Vercel separado**, una base PostgreSQL separada, carpetas de archivos y respaldos separadas y secretos diferentes. No ramificar producción con datos reales para testers. Aplicar migraciones y ejecutar `npm run db:seed` solo en ese destino ficticio. Los correos `example.test` no reciben correo real: para dar acceso a testers, el operador debe crear invitaciones para correos reales autorizados y asignar personajes ficticios desde el máster. No inventar cuentas personales.

Si se necesita el máster inicial del entorno de prueba, crear su membresía con un procedimiento de administración explícito y un correo del tester autorizado. El comando `bootstrap` crea la campaña real de nombres aportados, por lo que **no debe usarse para cargar esos nombres en un entorno público de demostración**. Un operador puede ejecutar SQL parametrizado para agregar el máster de pruebas a la campaña ficticia y luego invitar a los demás desde la aplicación.

Una preview debe fijar su `NEXTAUTH_URL` a su dominio efectivo; los enlaces de acceso de otro dominio no deben reutilizarse. No pegar una URL inventada: Vercel mostrará la URL cuando el despliegue realmente termine.

## Verificación después de desplegar

- Acceso HTTPS, enlace de un uso, caducidad y recuperación por correo real autorizado.
- Máster y dos testers ficticios: IDs ajenos, búsqueda, correspondencia, adjuntos y exportaciones sin filtraciones.
- Original en Drive privado: carga, lectura mediante servidor autorizado, integridad SHA-256 y retiro de permiso. No se generan enlaces públicos de Drive.
- Compra de prueba: una confirmación, sin duplicados ni saldo negativo.
- Respaldo del entorno de pruebas y restauración aislada.

Las pruebas locales no sustituyen estas comprobaciones externas. No usar datos de la campaña real hasta completarlas. No se deben mostrar vistas previas localhost como si fueran un despliegue público.

Las variables S3 de la tabla son opcionales para compatibilidad con archivos previos; no son requisitos para usar Drive.
