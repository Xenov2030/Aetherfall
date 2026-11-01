# Matriz de permisos

| Operación                                        | Máster activo                          | Propietario del personaje               | Otro jugador                  | Integración                             |
| ------------------------------------------------ | -------------------------------------- | --------------------------------------- | ----------------------------- | --------------------------------------- |
| Leer archivo privado, carpetas y preparación     | Sí                                     | No                                      | No                            | Solo entradas, si tiene `read`          |
| Leer ficha                                       | Todas en su campaña                    | Solo propia                             | No por defecto                | No con `draft`; con `read`, como máster |
| Editar estructura de ficha                       | Sí                                     | No; propone cambios                     | No                            | No                                      |
| Editar notas y recursos de ficha                 | Sí                                     | Solo campos habilitados por máster      | No                            | No                                      |
| Leer fragmento                                   | Sí                                     | Solo si está revelado a su personaje    | Solo con su propio permiso    | Con `read`, como máster                 |
| Revelar o retirar fragmento                      | Sí, destinatarios explícitos           | Propone compartir                       | No                            | Nunca                                   |
| Crear/mover carpetas, vincular                   | Sí, no publica                         | No                                      | No                            | `folders`, operaciones documentadas     |
| Descargar original / vista de imagen o PDF       | Sí                                     | Solo adjuntos de fragmento autorizado   | No si no está autorizado      | `files`                                 |
| Buscar y consultar por ID                        | Misma política de lectura              | Solo datos autorizados                  | Solo datos autorizados        | Limitado a campaña y scope              |
| Leer borrador de bitácora de jugador             | Solo si se compartió                   | Autor                                   | Solo destinatarios explícitos | No                                      |
| Editar/compartir bitácora                        | Solo propia                            | Autor                                   | No                            | No                                      |
| Leer correspondencia enviada                     | Sí                                     | Destinatario                            | No, ni actividad ni contador  | No                                      |
| Leer identidad real del remitente                | Sí                                     | No                                      | No                            | No                                      |
| Solicitar compra                                 | Puede operar campaña                   | Catálogo propio y personaje propio      | Solo su propio catálogo       | No                                      |
| Confirmar compra, entregar, consumir, transferir | Sí; transacción e historial            | Solicita al máster                      | No                            | No                                      |
| Tirada privada / historial                       | Solo historial propio                  | Solo propio                             | No                            | No                                      |
| Crear canon desde una propuesta                  | Decisión y acción manual               | Nunca automático                        | Nunca automático              | Nunca                                   |
| Exportar desde la web                            | Datos accesibles al máster             | Impresión de ficha/contenido disponible | Solo contenido propio         | No                                      |
| Respaldo administrativo completo                 | Operador con acceso al servidor y base | No                                      | No                            | No                                      |
| Crear/revocar credenciales                       | Sí, por campaña                        | No                                      | No                            | No                                      |

Cada endpoint vuelve a consultar membresía activa. Un JWT vigente no conserva acceso si el miembro fue desactivado. Las credenciales de integración también dependen de un máster activo.

Los jugadores reciben proyecciones con lista de campos permitidos. Las consultas filtran antes de enviar títulos, relaciones, archivos y contadores. No se usan placeholders de contenido oculto. Un fragmento usa su propio nombre conocido y no toma el título real del registro. Las búsquedas no devuelven coincidencias privadas.

La vista de personaje del máster es de solo lectura. No muestra borradores privados de jugadores ni historiales personales de dados. Esta vista no entrega una sesión al personaje ni concede permisos nuevos.

No existe publicación global: revelar siempre requiere seleccionar personajes y registrar si presenciaron, leyeron, recibieron o les contaron algo. Asistencia y conocimiento se guardan por separado. La papelera revoca temporalmente la lectura de entradas y sus originales; restaurar recupera los permisos previamente existentes.

La exportación web excluye borradores privados de otros autores y tiradas privadas ajenas. El respaldo administrativo de servidor incluye toda la campaña para poder restaurarla; requiere acceso directo del operador a sus credenciales, no un endpoint de jugador o integración. No incluye contraseñas SMTP, secretos JWT, hashes de tokens de integración ni tokens de acceso.

Con Drive, los permisos anteriores se verifican antes de descargar a través del servidor. No se agregan permisos de Google a los jugadores ni se comparten carpetas. Las credenciales OAuth nunca salen del servidor. Solo un máster activo puede comprobar la configuración o guardar un respaldo de su campaña en Drive; las integraciones externas no tienen esas operaciones.
