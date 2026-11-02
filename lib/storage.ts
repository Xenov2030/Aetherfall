import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { localMode } from './db';
import { assert } from './errors';
import { MAX_FILE_BYTES } from './upload-limits';
import { filesDrive } from './google-drive';
const root = () =>
  path.join(process.env.AETHERFALL_LOCAL_DIR || path.join(process.cwd(), '.local'), 'objects');
function s3() {
  assert(
    process.env.S3_BUCKET &&
      process.env.S3_ENDPOINT &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY,
    503,
    'Falta configurar el almacenamiento privado S3',
  );
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'auto',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
}
export function validateFile(data: Buffer, mime: string) {
  assert(
    data.length > 0 && data.length <= MAX_FILE_BYTES,
    400,
    'El archivo debe pesar entre 1 byte y 15 MB',
  );
  const valid =
    mime === 'application/pdf'
      ? data.subarray(0, 5).toString() === '%PDF-'
      : mime === 'image/png'
        ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mime === 'image/jpeg'
          ? data[0] === 255 && data[1] === 216 && data[2] === 255
          : mime === 'image/webp'
            ? data.subarray(0, 4).toString() === 'RIFF' &&
              data.subarray(8, 12).toString() === 'WEBP'
            : mime === 'text/plain'
              ? !data.includes(0) && !data.toString('utf8').includes('\ufffd')
              : false;
  assert(valid, 400, 'Tipo o firma inválida. Admitimos PNG, JPEG, WebP, PDF y texto UTF-8');
}
export function storageProvider(): 'local' | 'drive' | 's3' {
  const selected = process.env.STORAGE_PROVIDER;
  assert(
    !selected || ['local', 'drive', 's3'].includes(selected),
    503,
    'Proveedor de almacenamiento inválido',
  );
  if (selected === 'local') {
    assert(localMode(), 503, 'El almacenamiento local no está permitido en producción');
    return 'local';
  }
  if (selected) return selected as 'drive' | 's3';
  return localMode() ? 'local' : process.env.S3_BUCKET ? 's3' : 'drive';
}
export function proxyObject(key: string) {
  return key.startsWith('drive:') || (!key.startsWith('s3:') && localMode());
}
export async function putObject(
  key: string,
  data: Buffer,
  mime: string,
  name = key,
): Promise<string> {
  assert(/^[a-f0-9-]{36}$/.test(key), 400, 'Clave de archivo inválida');
  const provider = storageProvider();
  if (provider === 'drive') return filesDrive().upload(key, data, mime, name);
  if (provider === 'local') {
    await mkdir(root(), { recursive: true });
    await writeFile(path.join(root(), key), data, { flag: 'wx' });
    return key;
  }
  await s3().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: data,
      ContentType: mime,
    }),
  );
  return `s3:${key}`;
}
export async function readObject(key: string): Promise<Buffer> {
  if (key.startsWith('drive:')) return filesDrive().download(key);
  const explicitS3 = key.startsWith('s3:');
  if (explicitS3) key = key.slice(3);
  assert(/^[a-f0-9-]{36}$/.test(key), 400, 'Clave de archivo inválida');
  if (localMode() && !explicitS3) return readFile(path.join(root(), key));
  const r = await s3().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}
export async function signedObject(key: string, mime: string, name: string) {
  if (key.startsWith('s3:')) key = key.slice(3);
  assert(/^[a-f0-9-]{36}$/.test(key), 400, 'Clave de archivo inválida');
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      ResponseContentType: mime,
      ResponseContentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    }),
    { expiresIn: 60 },
  );
}
