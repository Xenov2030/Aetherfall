# Estado de la entrega

Implementación nueva sobre un repositorio que solo tenía un README. La especificación original se conserva íntegra. No existían dependencias ni datos Supabase que migrar.

## Alcance comprobable

| Etapa | Implementado                                                                                                                                                                                                                                         | Pendiente                                                                                                                                                                                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Acceso por invitación, enlace de un uso, recuperación, campañas, roles, propietarios, lectura centralizada, archivo, carpetas, sesiones, resúmenes por fragmento, ficha editable bajo permiso, adjuntos, papelera, versiones, impresión              | Verificar proveedores externos y despliegue real; miniaturas dedicadas; edición enriquecida (se usa texto plano seguro)                                                                                                                                                            |
| 2     | Asistencia privada, continuidad, bitácoras y momentos privados/compartidos, intenciones, conversaciones privadas con borradores y respuestas; misiones y pendientes editables y revelables; propuestas sin canon automático                          | Flujo especializado de aprobación/rechazo/vinculación de propuestas; comentarios privados sobre momentos; bandeja unificada de cierre, calendario/alertas de tiempo ficticio, relaciones percibidas y notificaciones incrementales                                                 |
| 3     | Inventario individual, monedas enteras configurables, entregas, consumo y transferencias del máster, productos privados, catálogos por personaje, precios ofrecidos y negociados, solicitudes, compra atómica/idempotente, historial, dados privados | Fondo común y botín grupal con reparto especializado; solicitudes específicas de transferencia/consumo de jugadores; tablones y conversión de anuncios a misiones; retratos de tiendas, ajustes de stock/precio con editor dedicado, catálogos por categoría y tiradas compartidas |
| 4     | API separada con scopes, hashes, revocación, campaña acotada, borradores privados y conflicto de versiones; evaluación oficial de MCP documentada                                                                                                    | Adaptador MCP/OAuth de ChatGPT; puzzles, símbolos/contraseñas y desbloqueos por condiciones; mejoras avanzadas de preparación                                                                                                                                                      |

Los módulos pendientes no tienen botones que finjan ejecutarlos. Las herramientas genéricas de entradas guardan contenido real y privado, pero no se presentan como todos los flujos especializados de las etapas futuras.

## Verificación

- Compilación de producción, TypeScript y verificación de formato aprobados; repetir los comandos del README tras cambios.
- 25 pruebas de dominio aprobadas contra PostgreSQL real y aislado: permisos, fragmentos, ausencias, edición/versiones, adjuntos, revocación de miembros, bitácoras, correspondencia, dinero exacto, transacciones concurrentes, idempotencia, credenciales y restauración completa.
- Las mismas 25 pruebas aprobadas en bases temporales PGlite; no se usa para afirmar concurrencia multiproceso de producción.
- Chromium con enlaces Auth.js de un uso y SMTP local: creación mediante interfaz, máster y dos jugadores, IDs ajenos, búsqueda, adjuntos, ficha persistente, conflictos, CSRF, vista personaje, retirada de accesos, exportación, dados y vista móvil. También aprobó bitácoras, correspondencia, compras y credenciales revocables mediante HTTP/UI.
- Capturas en `docs/capturas`, exclusivamente de la campaña ficticia. No prueban un despliegue público.
- Preparación local repetida sin borrar ni duplicar la campaña ficticia.
- Auditoría npm de dependencias de producción sin avisos después de actualizar Nodemailer; debe repetirse antes de desplegar.

## Límites concretos

- No hay conexión validada con PostgreSQL/Drive/SMTP externos: faltan cuentas/configuración. No hay URL pública nueva ni se modificó el sitio Vercel aportado.
- El modo local no se habilita en producción. Las pruebas de almacenamiento local validan autorización y bytes, pero no sustituyen una prueba de carpetas y originales en la cuenta real del proveedor elegido.
- Subidas originales de hasta 3 MB, de tipos admitidos; no hay antivirus, OCR, miniaturas persistidas ni procesamiento de archivos grandes. Los originales no se alteran.
- Textos planos: no hay importación HTML ni ejecución de contenido de documentos. Etiquetas y datos de varios tipos todavía usan el editor de datos complementarios; algunas pantallas son deliberadamente sencillas.
- Historial recuperable para entradas/fichas; los fragmentos son instantáneas inmutables: preparar uno nuevo y retirar el anterior para corregir una revelación. No hay editor de versiones de fragmento ni de adjuntos.
- El rol de máster autoriza a ver los campos de la ficha y contenido de campaña, pero no los borradores privados de bitácoras ni tiradas privadas ajenas mediante API web. El operador con credenciales de base sí tiene acceso administrativo para respaldo; no se promete cifrado extremo a extremo frente a ese operador.
- El respaldo web está sujeto a tamaño/duración del proveedor. El CLI permite respaldo administrativo completo, también en Drive tras autorizarlo, con originales e integridad comprobada. No hay programación automática de copias ni retención remota configurada.
- El acceso de un jugador está ligado a un correo; perder la cuenta de correo requiere intervención administrativa. No hay recuperación manual automática ni claves maestras ocultas.
- Las credenciales personales de integración no son OAuth ni un servidor MCP. No dan acceso a este chat ni a archivos no proporcionados. No afirman conectar ChatGPT.
- El servidor local de correo solo acepta dominios ficticios `example.test`; para testers por Internet se necesitan correos autorizados y SMTP real.

## Antes de usar producción

Completar [despliegue](despliegue.md), revisar facturación de los proveedores, verificar correo y carpetas privadas de Drive, probar máster y dos jugadores en la URL real y ejecutar respaldo/restauración del entorno de pruebas. La publicación del entorno de nube también es una acción separada del producto: guardar su configuración no publica ni demuestra restauración en otra tarea.

## Integración de Drive añadida

Adaptador OAuth oficial, originales privados, comprobación de carpetas y pertenencia, descargas por servidor con validación de integridad, respaldo web/CLI, comandos de autorización y preparación, y lectura compatible con archivos anteriores. Las pruebas de Drive usan transporte controlado y no demuestran acceso a la cuenta real. La autorización del usuario sigue pendiente; ver [pasos exactos](google-drive.md).

Validación adicional de Drive: 9 pruebas con transporte controlado de privacidad, originales, referencias y errores; 34 pruebas totales del comando `npm test`. La conexión real no está validada.
