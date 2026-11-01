# Arquitectura y modelo de datos

## Decisiones

Next.js 16 con App Router y TypeScript: interfaz adaptable, páginas de acceso y funciones Node.js en el mismo proyecto Vercel. La interfaz no recibe credenciales de base, SMTP, Google Drive ni S3. No hay almacenamiento principal en localStorage, demonios de aplicación en producción, jobs que ejecuten la aventura ni dependencia de Supabase.

PostgreSQL mediante `pg`, consultas parametrizadas y migraciones SQL versionadas. Las transacciones bloquean compras y existencias. Dinero almacenado como `bigint`, transmitido como cadenas enteras y calculado con `BigInt`, sin redondeos de punto flotante. La unidad base y sus denominaciones las decide el máster; no se cargan conversiones ni monedas de ninguna edición de D&D.

Auth.js / NextAuth mantiene la emisión y verificación de enlaces de acceso, tokens de un uso y cookies JWT cifradas con caducidad de ocho horas. El adaptador guarda usuarios y hashes de verificación en PostgreSQL. Cada operación comprueba la membresía activa de nuevo. El correo sirve únicamente para acceso solicitado por el usuario; no hay integración con WhatsApp ni envío automático de invitaciones, correspondencia o notificaciones externas.

Google Drive del máster para originales y respaldos privados. OAuth oficial de usuario con alcance `drive.file`, credenciales solo en variables del servidor y carpetas no compartidas. Las descargas se sirven mediante la API de Aetherfall, sin enviar IDs, tokens ni enlaces públicos de Drive al navegador. Se comprueban pertenencia a carpeta, marca de aplicación, tamaño y hash del original. S3 sigue disponible como alternativa compatible con referencias anteriores.

En el adaptador S3: Se verifica autorización en cada enlace de aplicación y se firma el objeto durante 60 segundos. Retirar permisos impide generar nuevos enlaces, pero uno previamente firmado puede vivir hasta su caducidad y una descarga ya realizada no puede borrarse. Los archivos son inmutables, con clave aleatoria y SHA-256. Producción nunca escribe archivos subidos en disco de Vercel, con ninguno de los proveedores.

Desarrollo: PostgreSQL nativo en loopback, contraseña aleatoria, autenticación SCRAM y directorio `.local/native-postgres`. Archivos y buzón ficticio en `.local`, fuera de Git. PGlite se reserva como motor ligero de pruebas temporales; **no es el servidor persistente de desarrollo**. Durante el desarrollo se detectó un fallo de checkpoint tras interrumpir un proceso PGlite, se preservó su directorio de prueba y se sustituyó por PostgreSQL nativo. Las pruebas de concurrencia se repiten con el motor nativo.

## Modelo

| Tablas                           | Responsabilidad                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| campaigns                        | Aislamiento de campaña, nombre, grupo, tiempo del mundo y bandera de demostración                 |
| users, members, invitations      | Identidad, rol por campaña, desactivación, admisión por invitación con vencimiento                |
| verification_tokens, rate_limits | Acceso de un uso y límites persistentes de operaciones                                            |
| folders                          | Jerarquía privada; mover o renombrar no revela contenido                                          |
| records                          | Entradas privadas tipadas, ficha, sesiones, notas, propuestas y estados                           |
| fragments                        | Título y contenido expresamente preparados para revelación; independientes de los campos privados |
| grants                           | Personaje, fragmento, origen del conocimiento y primera apertura comprobable                      |
| attachments                      | Original, tipo, tamaño, hash, registro y fragmento opcional                                       |
| record_links                     | Relaciones privadas sin concesión implícita de permisos                                           |
| revisions, audit                 | Versiones recuperables y acciones importantes                                                     |
| journals, journal_recipients     | Borradores propios y destinatarios explícitos; tampoco se filtran mediante exportación del máster |
| threads, thread_messages         | Correspondencia, identidad visible y real separadas, borrador/envío, respuestas y apertura        |
| currencies, wallets              | Denominaciones y saldo exacto por personaje                                                       |
| products, catalog_grants         | Existencias y notas privadas separadas del catálogo mostrado por personaje                        |
| purchases                        | Solicitud, precio negociable y confirmación transaccional                                         |
| inventory_items, movements       | Custodia, entregas, consumo, transferencias y trazabilidad                                        |
| operation_keys                   | Serializa reintentos concurrentes con la misma clave de idempotencia                              |
| integration_tokens               | Hash de credencial, campaña, propietario, permisos y revocación                                   |

Las entidades comparten `records` con `kind`: session, character, lore, npc, villain, relic, mechanic, idea, journal, moment, message, quest, pending, attendance y proposal. Las tiradas se conservan en registros internos excluidos del archivo y se consultan solo como historial del usuario.

Los datos compartibles de la ficha van en `data.sheet`, `identity`, inventario conocido, notas del jugador y recursos habilitados. Notas privadas del máster en `body` o claves privadas fuera de esa lista. **No introducir secretos dentro de `data.sheet`: esa sección está diseñada para el propietario.** Las propiedades reales de reliquias y evoluciones futuras se guardan en entradas privadas, y solo se comparte un fragmento seleccionado.

Las relaciones usan claves foráneas de campaña y verificaciones de servicio. El servidor valida también que un propietario pertenezca a la campaña, una carpeta no cree ciclos y un adjunto de fragmento corresponda al mismo registro. Los enlaces, sesiones y carpetas nunca conceden acceso.

## Límites operativos

La política central de lectura está en `lib/policy.ts`; las operaciones de dominio, en `service`, `community` y `commerce`. La única entrada HTTP de negocio comprueba sesión o credencial, campaña, rol, origen, tasa y esquema. No hay caché compartida de datos privados; las respuestas usan `private, no-store` y `Vary: Cookie`.

Contenido escrito: texto plano escapado por React. No se admite HTML enriquecido ni se ejecuta texto de documentos como instrucciones. CSP, `nosniff`, `no-referrer`, protección de marcos y foco visible complementan la autorización.

El esquema de autenticación y autorización no reemplaza permisos administrativos del proveedor: quien tenga las credenciales de la base puede leer sus datos. Las credenciales de operación deben ser privadas y separadas de las de pruebas.
