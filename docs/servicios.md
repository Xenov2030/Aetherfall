# Servicios y condiciones verificadas

Consulta realizada el 1 de noviembre de 2026. Las páginas comerciales directas fueron bloqueadas por la política de red de este entorno. Se consultaron las fuentes oficiales publicadas por sus proveedores en GitHub. Los límites pueden cambiar: revisar los paneles antes de activar una cuenta. No se abrió ni contrató ningún servicio.

## PostgreSQL: Neon Free como primera opción

[Planes oficiales](https://neon.com/docs/introduction/plans), [fuente oficial consultada](https://github.com/neondatabase/website/blob/main/content/docs/introduction/plans.md).

La documentación consultada indica en Free: 100 proyectos, 10 ramas por proyecto, 100 CU-horas por proyecto, 1 GB de PostgreSQL por proyecto con 20 GB en total por cuenta, 5 GB de transferencia pública por proyecto y suspensión tras cinco minutos. No se promete un SLA de producción. El plan Free cuesta USD 0 dentro de sus límites; si no alcanza, se evalúa otro proveedor o un plan pago autorizado. El arranque tras suspensión puede agregar latencia al primer acceso.

Launch publica USD 0,106 por CU-hora y USD 0,35 por GB-mes; no se activa desde esta aplicación. Usar una URL PostgreSQL con pool y TLS verificado. Para pruebas, crear un proyecto/base separado, no una copia con secretos de la campaña real.

La aplicación no depende de la API de Neon. Un PostgreSQL gestionado compatible también sirve; debe ofrecer conectividad desde Vercel, TLS, conexiones suficientes y respaldo. Autohospedarlo implicaría mantenimiento y un servicio siempre encendido fuera de Vercel, por lo que no es la opción inicial.

## Archivos: tu Google Drive (opción elegida)

La integración usa OAuth de tu cuenta con alcance `drive.file`, carpetas creadas para Aetherfall y descargas autorizadas a través del servidor. No hay carpetas públicas ni acceso automático al resto de tu Drive. El espacio disponible y las políticas corresponden a tu cuenta; no se contrata almacenamiento adicional. La conexión real sigue pendiente de autorización. Ver [configuración, pruebas y fuentes oficiales](google-drive.md).

## Alternativa anterior: Cloudflare R2 Standard compatible con S3

[Precios oficiales](https://developers.cloudflare.com/r2/pricing/), [fuente consultada](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/r2/pricing.mdx), [alta oficial](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/r2/get-started/index.mdx).

El nivel incluido publica 10 GB-mes de almacenamiento, un millón de operaciones Clase A y diez millones Clase B al mes, con salida a Internet sin tarifa de egress de R2. Solo aplica a Standard, no Infrequent Access. Fuera de lo incluido: USD 0,015/GB-mes, USD 4,50/millón Clase A y USD 0,36/millón Clase B, según la tabla consultada. Otros servicios conectados pueden cobrar por su cuenta.

**Requiere una cuenta Cloudflare, una suscripción R2 y completar el flujo de checkout/facturación.** No se activó: que exista uso incluido no equivale a una cuenta sin posibilidad de cargos. El usuario debe revisar estas condiciones y autorizar el alta. Configurar alertas y límites disponibles en el proveedor; esta aplicación no impone un techo a su factura.

El bucket debe ser privado, sin dominio público ni `r2.dev` habilitado. Credenciales restringidas al bucket y acciones necesarias. R2 se consideró inicialmente por la compatibilidad S3 y los enlaces temporales; el usuario eligió después su Drive, por lo que no es necesario contratar R2. El adaptador funciona también con otro S3 privado compatible. Se consideró Backblaze B2 como alternativa, pero su página de condiciones fue bloqueada y no se afirman cuotas o gratuidad sin verificarlas.

## Autenticación: biblioteca y SMTP

[Fuente oficial de Auth.js](https://github.com/nextauthjs/next-auth), [proveedor de correo](https://github.com/nextauthjs/next-auth/blob/main/packages/core/src/providers/nodemailer.ts).

Auth.js es una biblioteca ejecutada en el servidor, no una cuenta de autenticación comercial que haya que contratar. Los usuarios, invitaciones y hashes de enlaces quedan en la propia base. Necesita un secreto fuerte y SMTP para recibir enlaces; el precio, la cuota y la verificación del remitente dependen del servicio SMTP elegido. No se eligió uno sin cuenta ni se prometió entrega gratuita. Podés usar un SMTP existente autorizado. Recuperación: nuevo enlace al mismo correo; si se pierde el correo, intervención del máster.

Nodemailer está fijado a 10.3.1 con override de su dependencia de NextAuth porque la versión anterior tenía avisos de seguridad. El envío de acceso se verificó con SMTP local y enlaces reales; el envío por un proveedor externo permanece pendiente. Revisar la auditoría antes de actualizar dependencias.

## Vercel

Usar el proyecto existente si se obtiene acceso a él. No se pudo inspeccionar `aetherfall-rho.vercel.app` por el bloqueo de red; no se afirma que pertenezca al repositorio ni que se haya actualizado. El plan, las condiciones de uso, límites de funciones, transferencias y correos no se verificaron directamente en el panel. Revisarlos antes de publicar; no se activan planes pagos.

La aplicación limita los originales a 3 MB para mantener cada subida multipart por debajo de los límites habituales de cuerpo de funciones de Vercel. El respaldo completo se ofrece también por CLI para no depender del tamaño máximo de una respuesta HTTP. Las miniaturas dedicadas y las subidas directas grandes no están implementadas.
