import { OAuth2Client } from 'google-auth-library';
import { randomUUID } from 'node:crypto';
import { assert, HttpError } from './errors';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
export type DriveRequest = {
  url: string;
  method?: 'GET' | 'POST';
  data?: unknown;
  headers?: Record<string, string>;
  responseType?: 'arraybuffer';
};
export type DriveTransport = (request: DriveRequest) => Promise<{ data: any }>;
const validId = (id: string) => /^[A-Za-z0-9_-]{10,200}$/.test(id);

export function driveCredentialsPresent() {
  return [
    'GOOGLE_DRIVE_CLIENT_ID',
    'GOOGLE_DRIVE_CLIENT_SECRET',
    'GOOGLE_DRIVE_REFRESH_TOKEN',
  ].every((name) => !!process.env[name]);
}
export function driveTransport(): DriveTransport {
  assert(
    driveCredentialsPresent(),
    503,
    'Falta autorizar tu cuenta de Google Drive. Revisá la configuración del servidor.',
  );
  const client = new OAuth2Client({
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
  });
  client.setCredentials({ refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN });
  return async (request) => {
    try {
      return await client.request(request);
    } catch (error) {
      // Google errors can include authorization headers and refresh tokens. Never forward or log them.
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403)
        throw new HttpError(
          503,
          'Google Drive no autorizó la operación. Revisá la conexión y los permisos de la carpeta.',
        );
      if (status === 404)
        throw new HttpError(404, 'El archivo o la carpeta de Drive ya no está disponible.');
      if (status === 429)
        throw new HttpError(
          503,
          'Google Drive alcanzó un límite temporal. Intentá de nuevo más tarde.',
        );
      throw new HttpError(503, 'No se pudo completar la operación con Google Drive.');
    }
  };
}
export class GoogleDriveStore {
  constructor(
    private request: DriveTransport,
    readonly folderId: string,
  ) {
    assert(
      validId(folderId),
      503,
      'Configurá una carpeta privada de Google Drive creada para Aetherfall.',
    );
  }
  private async metadata(id: string) {
    assert(validId(id), 400, 'Referencia de Drive inválida');
    return (
      await this.request({
        url: `${API}/files/${id}?fields=id,mimeType,parents,trashed,shared,ownedByMe,size,appProperties,capabilities(canAddChildren)`,
      })
    ).data;
  }
  async verifyFolder() {
    const f = await this.metadata(this.folderId);
    assert(
      f.id === this.folderId &&
        f.mimeType === 'application/vnd.google-apps.folder' &&
        !f.trashed &&
        f.ownedByMe === true &&
        f.shared === false &&
        f.capabilities?.canAddChildren === true,
      503,
      'La carpeta de Aetherfall debe pertenecer a tu cuenta y ser privada, sin compartir en Drive.',
    );
    return { ready: true as const };
  }
  async upload(key: string, bytes: Buffer, mime: string, name = key) {
    assert(/^[a-f0-9-]{36}$/.test(key), 400, 'Clave de archivo inválida');
    assert(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime), 400, 'Tipo de archivo inválido');
    await this.verifyFolder();
    const boundary = 'aetherfall_' + randomUUID();
    const metadata = {
      name: name.replace(/[\x00-\x1f\x7f]/g, '_').slice(0, 180),
      mimeType: mime,
      parents: [this.folderId],
      appProperties: { aetherfall: '1', objectKey: key },
    };
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const result = (
      await this.request({
        url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        data: body,
      })
    ).data;
    assert(
      typeof result.id === 'string' && validId(result.id),
      503,
      'Drive no confirmó el archivo subido',
    );
    return `drive:${result.id}`;
  }
  async download(reference: string, maxBytes = 3 * 1024 * 1024) {
    assert(reference.startsWith('drive:'), 400, 'Referencia de Drive inválida');
    const id = reference.slice(6);
    await this.verifyFolder();
    const f = await this.metadata(id);
    assert(
      !f.trashed &&
        f.ownedByMe === true &&
        f.shared === false &&
        f.parents?.includes(this.folderId) &&
        f.appProperties?.aetherfall === '1',
      404,
      'El archivo no pertenece al archivo privado de Aetherfall',
    );
    assert(
      /^\d+$/.test(String(f.size)) && BigInt(f.size) <= BigInt(maxBytes),
      413,
      'El archivo de Drive supera el tamaño admitido',
    );
    const result = await this.request({
      url: `${API}/files/${id}?alt=media`,
      responseType: 'arraybuffer',
    });
    const bytes = Buffer.from(result.data);
    assert(
      bytes.length <= maxBytes && BigInt(bytes.length) === BigInt(f.size),
      409,
      'El archivo de Drive cambió durante la descarga',
    );
    return bytes;
  }
}
export function filesDrive() {
  return new GoogleDriveStore(driveTransport(), process.env.GOOGLE_DRIVE_FILES_FOLDER_ID || '');
}
export function backupsDrive() {
  return new GoogleDriveStore(driveTransport(), process.env.GOOGLE_DRIVE_BACKUPS_FOLDER_ID || '');
}
export async function createDriveFolders() {
  const request = driveTransport();
  const create = async (name: string, parent?: string) => {
    const result = (
      await request({
        url: `${API}/files?fields=id`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: {
          name,
          mimeType: 'application/vnd.google-apps.folder',
          ...(parent ? { parents: [parent] } : {}),
          appProperties: { aetherfall: '1' },
        },
      })
    ).data;
    assert(validId(result.id), 503, 'Google no confirmó la carpeta');
    return result.id as string;
  };
  const root = await create('Aetherfall');
  const files = await create('Archivos', root);
  const backups = await create('Respaldos', root);
  return { files, backups };
}
