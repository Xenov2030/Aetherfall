import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  GoogleDriveStore,
  driveTransport,
  type DriveRequest,
  type DriveTransport,
} from '../lib/google-drive';
import { storageProvider, putObject, readObject, proxyObject } from '../lib/storage';
const folder = 'test_folder_private_123',
  file = 'test_file_private_456';
const saved = { ...process.env };
afterEach(() => {
  mock.restoreAll();
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});
function fake(
  options: { sharedFolder?: boolean; file?: Record<string, unknown>; bytes?: Buffer } = {},
) {
  const requests: DriveRequest[] = [];
  const bytes = options.bytes ?? Buffer.from('Original privado de prueba');
  const transport: DriveTransport = async (req) => {
    requests.push(req);
    if (req.url.includes('/files/' + folder + '?'))
      return {
        data: {
          id: folder,
          mimeType: 'application/vnd.google-apps.folder',
          ownedByMe: true,
          shared: options.sharedFolder ?? false,
          trashed: false,
          capabilities: { canAddChildren: true },
        },
      };
    if (req.url.includes('upload/drive')) return { data: { id: file } };
    if (req.url.includes('alt=media')) return { data: bytes };
    return {
      data: {
        id: file,
        ownedByMe: true,
        shared: false,
        trashed: false,
        parents: [folder],
        appProperties: { aetherfall: '1' },
        size: String(bytes.length),
        ...options.file,
      },
    };
  };
  return { requests, transport, bytes };
}
test('Drive: sube originales con carpeta privada y sin publicar ni crear permisos', async () => {
  const f = fake();
  const store = new GoogleDriveStore(f.transport, folder);
  const key = randomUUID();
  const ref = await store.upload(key, f.bytes, 'text/plain', 'Carta privada.txt');
  assert.equal(ref, `drive:${file}`);
  assert.equal(f.requests.length, 2);
  const upload = f.requests[1];
  assert.equal(upload.method, 'POST');
  const body = upload.data as Buffer;
  assert(body.includes(f.bytes));
  assert(body.toString().includes(`"parents":["${folder}"]`));
  assert(body.toString().includes('Carta privada.txt'));
  assert(body.toString().includes(`"objectKey":"${key}"`));
  assert(!f.requests.some((r) => r.url.includes('/permissions')));
  assert(!body.toString().includes('anyone'));
});
test('Drive: descarga únicamente bytes autorizables sin devolver enlaces de Google', async () => {
  const f = fake();
  const result = await new GoogleDriveStore(f.transport, folder).download(`drive:${file}`);
  assert(result.equals(f.bytes));
  assert.equal(f.requests.length, 3);
  assert(f.requests[2].url.endsWith('?alt=media'));
});
test('Drive: una carpeta compartida impide subir o descargar', async () => {
  const f = fake({ sharedFolder: true });
  const store = new GoogleDriveStore(f.transport, folder);
  await assert.rejects(store.upload(randomUUID(), f.bytes, 'text/plain'), { status: 503 });
  await assert.rejects(store.download(`drive:${file}`), { status: 503 });
  assert(!f.requests.some((r) => r.url.includes('alt=media') || r.url.includes('upload/drive')));
});
test('Drive: rechaza archivos ajenos, compartidos, en papelera o fuera de la carpeta', async () => {
  for (const fileMetadata of [
    { ownedByMe: false },
    { shared: true },
    { trashed: true },
    { parents: ['another_folder_789'] },
    { appProperties: {} },
  ]) {
    const f = fake({ file: fileMetadata });
    await assert.rejects(new GoogleDriveStore(f.transport, folder).download(`drive:${file}`), {
      status: 404,
    });
    assert(!f.requests.some((r) => r.url.includes('alt=media')));
  }
});
test('Drive: valida identificadores, tamaño y cambios durante la descarga', async () => {
  const f = fake({ file: { size: String(4 * 1024 * 1024) } });
  await assert.rejects(new GoogleDriveStore(f.transport, folder).download(`drive:${file}`), {
    status: 413,
  });
  assert(!f.requests.some((r) => r.url.includes('alt=media')));
  assert.throws(() => new GoogleDriveStore(f.transport, '../../private'), { status: 503 });
  const changed = fake({ file: { size: '1' } });
  await assert.rejects(new GoogleDriveStore(changed.transport, folder).download(`drive:${file}`), {
    status: 409,
  });
});
test('Drive: configuración elegida sin credenciales falla sin usar almacenamiento local como sustituto', async () => {
  process.env.AETHERFALL_LOCAL = '1';
  delete process.env.VERCEL;
  process.env.STORAGE_PROVIDER = 'drive';
  for (const k of [
    'GOOGLE_DRIVE_CLIENT_ID',
    'GOOGLE_DRIVE_CLIENT_SECRET',
    'GOOGLE_DRIVE_REFRESH_TOKEN',
  ])
    delete process.env[k];
  assert.equal(storageProvider(), 'drive');
  await assert.rejects(putObject(randomUUID(), Buffer.from('Texto'), 'text/plain'), {
    status: 503,
  });
});
test('Drive: usa OAuth oficial sin exponer errores que contienen credenciales', async () => {
  process.env.GOOGLE_DRIVE_CLIENT_ID = 'client-id-ficticio';
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'secreto-sintetico-de-prueba';
  process.env.GOOGLE_DRIVE_REFRESH_TOKEN = 'token-sintetico-de-prueba';
  mock.method(OAuth2Client.prototype, 'request', async () => {
    throw {
      response: { status: 401, data: { refresh_token: 'NO_MOSTRAR' } },
      config: { headers: { Authorization: 'NO_MOSTRAR' } },
    };
  });
  await assert.rejects(
    driveTransport()({ url: 'https://www.googleapis.com/drive/v3/files' }),
    (e: Error) => {
      assert(!e.message.includes('NO_MOSTRAR'));
      assert(!e.message.includes('sintetico'));
      return true;
    },
  );
});
test('Drive: referencias persistidas seleccionan Drive aunque el entorno tenga archivos locales', async () => {
  process.env.AETHERFALL_LOCAL = '1';
  delete process.env.VERCEL;
  process.env.GOOGLE_DRIVE_CLIENT_ID = 'client-id-ficticio';
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'secreto-sintetico';
  process.env.GOOGLE_DRIVE_REFRESH_TOKEN = 'token-sintetico';
  process.env.GOOGLE_DRIVE_FILES_FOLDER_ID = folder;
  mock.method(GoogleDriveStore.prototype, 'download', async function (reference: string) {
    assert.equal(reference, `drive:${file}`);
    return Buffer.from('Contenido privado');
  });
  assert.equal((await readObject(`drive:${file}`)).toString(), 'Contenido privado');
});

test('Compatibilidad: una referencia S3 explícita conserva su proveedor incluso en desarrollo local', async () => {
  process.env.AETHERFALL_LOCAL = '1';
  delete process.env.VERCEL;
  process.env.STORAGE_PROVIDER = 's3';
  Object.assign(process.env, {
    S3_ENDPOINT: 'https://s3.example.test',
    S3_BUCKET: 'bucket-ficticio',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'credencial-sintetica',
    S3_SECRET_ACCESS_KEY: 'secreto-sintetico',
  });
  const key = randomUUID(),
    bytes = Buffer.from('Original S3 de prueba');
  mock.method(S3Client.prototype, 'send', async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      assert.equal(command.input.Key, key);
      return {};
    }
    assert(command instanceof GetObjectCommand);
    assert.equal(command.input.Key, key);
    return { Body: { transformToByteArray: async () => bytes } };
  });
  const ref = await putObject(key, bytes, 'text/plain');
  assert.equal(ref, `s3:${key}`);
  assert.equal(proxyObject(ref), false);
  assert((await readObject(ref)).equals(bytes));
});
