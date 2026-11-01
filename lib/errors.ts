export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  status = 404,
  message = 'Contenido no disponible',
): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
