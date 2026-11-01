# Respaldo y restauración

## Dos alcances diferentes

La exportación desde **Campaña** respeta los permisos del máster. Incluye sus entradas privadas, archivos, relaciones e historial, pero excluye borradores privados de jugadores que no le hayan compartido y tiradas privadas ajenas. No debe tratarse como el respaldo administrativo íntegro de toda la base.

El comando de operador requiere credenciales de servidor y produce el respaldo completo de campaña, incluyendo borradores propios de jugadores. No está expuesto a jugadores ni integraciones. El JSON contiene información privada y archivos en Base64. Guardarlo cifrado, fuera del repositorio y con acceso restringido. Los hashes de credenciales de integración y tokens de login no se exportan; las integraciones se vuelven a configurar tras restaurar.

Con las variables del destino correcto cargadas de forma segura:

```sh
npm run backup -- UUID_CAMPAÑA UUID_MÁSTER /ruta/privada/aetherfall.json
```

La ruta debe ser nueva: no se sobrescriben respaldos existentes. El comando comprueba que el usuario sea un máster activo de esa campaña, recoge las tablas en una transacción y comprueba SHA-256 de todos los originales. Los objetos existentes son inmutables.

Para campañas grandes, usar CLI y respaldos nativos del proveedor. La exportación web puede superar el tamaño o la duración permitidos por Vercel. No es un sistema automático de copias ni retención; configurar una periodicidad y verificar la copia periódicamente. El CLI no requiere que la aplicación esté abierta ni un proceso permanente de aplicación.

## Copia en tu Drive

La pantalla Campaña puede guardar el respaldo de datos accesibles al máster en tu Drive privado. `npm run backup:drive -- UUID_CAMPAÑA UUID_MÁSTER` produce la copia administrativa completa desde el servidor. Requiere la autorización y carpetas de la [guía de Drive](google-drive.md); no es una conexión activa hasta configurarla.

## Restaurar

Preparar **una base aislada y carpetas de Drive de destino privadas y separadas (o un bucket privado, si se usa S3)**, con las variables de ese destino. No mezclar producción y pruebas. Instalar dependencias y ejecutar:

```sh
npm run restore -- /ruta/privada/aetherfall.json --confirmar-base-destino
```

El comando aplica migraciones faltantes. Rechaza restaurar una campaña que ya existe. Verifica formato, claves de objetos, tamaño, firma y hashes; carga originales y después inserta los datos en una transacción, ordenando carpetas por jerarquía. Si falla la inserción, no queda una campaña a medias; podrían quedar objetos huérfanos que el operador debe revisar. Los identificadores de campaña, registros y adjuntos se conservan para mantener relaciones, permisos, historial e idempotencia. Los IDs de archivo del proveedor se reasignan cuando el destino lo requiere; los originales viajan dentro del respaldo y se verifican por bytes y SHA-256.

Tras restaurar:

1. Comparar cantidades por tabla y hashes de archivos.
2. Iniciar la aplicación contra ese destino aislado.
3. Comprobar roles activos, fichas, revelaciones, mensajes y adjuntos con cuentas de prueba autorizadas.
4. Reconfigurar SMTP, secreto JWT y credenciales de integración: no van dentro del respaldo.
5. Conservar la base original hasta terminar la validación y planificar aparte cualquier cambio de producción.

**Evidencia:** `npm run test:postgres` exporta una campaña con máster y dos jugadores, archivos, relaciones, versiones, bitácoras, mensajes, productos, compras y movimientos; restaura el resultado en otra base aislada, vuelve a exportarlo y compara cantidades de todas las tablas y bytes de los originales. Esto verifica el procedimiento, sin afirmar que haya un respaldo remoto de producción.

La escritura del servidor de campaña y la subida de originales no necesitan detenerse porque las claves de objetos son inmutables. Aun así, para una copia operativa coherente de una sesión importante, coordinar una pausa de edición simplifica la verificación. El respaldo nativo de todo PostgreSQL más una copia/versionado del bucket sigue siendo recomendable para recuperación de desastre.
