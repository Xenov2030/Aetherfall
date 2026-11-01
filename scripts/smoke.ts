import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { readFile, unlink, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DEMO } from './seed';
const origin = 'http://localhost:3000',
  base = `${origin}/api/campaigns/${DEMO}`;
async function main() {
  assert(
    process.env.AETHERFALL_LOCAL === '1' &&
      !process.env.VERCEL &&
      (!process.env.STORAGE_PROVIDER || process.env.STORAGE_PROVIDER === 'local'),
    'Las pruebas de navegador requieren almacenamiento local, sin escribir en tu Drive personal.',
  );
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox'],
  });
  const errors: string[] = [];
  async function login(
    email: string,
    viewport = { width: 1440, height: 1000 },
    loginPath = '/login',
  ) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const file = path.join(process.cwd(), '.local/mail', `${email}.eml`);
    await unlink(file).catch(() => {});
    await page.goto(`${origin}${loginPath}`);
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByRole('button', { name: 'Recibir enlace de acceso' }).click();
    let raw = '';
    for (let i = 0; i < 120; i++) {
      try {
        raw = await readFile(file, 'utf8');
        if (raw.includes('callback')) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    assert(raw, 'El correo de acceso debe llegar al buzón local');
    const decoded = raw
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&amp;/g, '&');
    const url = decoded.match(/http:\/\/localhost:3000\/api\/auth\/callback\/email[^\s"<>]+/)?.[0];
    assert(url, 'Debe existir un enlace Auth.js real');
    await page.goto(url);
    await page.waitForURL(`**/campana/${DEMO}`, { timeout: 45000 });
    await page
      .getByRole('heading', {
        name: email.startsWith('master')
          ? 'Todo listo para la próxima historia.'
          : 'Antes de volver a jugar.',
      })
      .waitFor();
    return { context, page };
  }
  async function api(context: BrowserContext, route: string, method = 'GET', data?: unknown) {
    const r = await context.request.fetch(base + route, {
      method,
      headers: { Origin: origin },
      data,
    });
    return { status: r.status(), data: await r.json() };
  }
  try {
    const anon = await browser.newContext();
    assert.equal((await anon.request.get(base + '/overview')).status(), 401);
    await anon.close();
    const master = await login('master@example.test');
    assert.equal(
      (await api(master.context, '/storage')).data.provider,
      'local',
      'El servidor debe usar almacenamiento local para esta prueba',
    );
    const choiceEmail = `eleccion-${Date.now()}@example.test`;
    await master.page.getByRole('button', { name: 'Campaña', exact: true }).click();
    await master.page
      .getByRole('button', { name: 'Obtener enlace para jugadores', exact: true })
      .click();
    const shareInput = master.page.getByLabel('Enlace para compartir', { exact: true });
    await shareInput.waitFor();
    const sharedPath = (await shareInput.inputValue()).replace(origin, '');
    await master.page.getByRole('button', { name: 'Inicio', exact: true }).click();
    const candidate = await api(master.context, '/records', 'POST', {
      kind: 'character',
      title: `Elección ${Date.now()}`,
      data: { selfSelectable: true },
      body: 'Ficha privada',
    });
    assert.equal(candidate.status, 201);
    const chooser = await login(choiceEmail, undefined, sharedPath);
    await chooser.page.getByLabel('Personaje disponible').selectOption(candidate.data.id);
    chooser.page.once('dialog', (dialog) => dialog.accept());
    await chooser.page.getByRole('button', { name: 'Confirmar personaje', exact: true }).click();
    await chooser.page
      .getByText('Tu personaje está asignado. Solo el máster puede cambiar esta asignación.', {
        exact: true,
      })
      .waitFor();
    await chooser.page.reload();
    await chooser.page
      .getByText('Tu personaje está asignado. Solo el máster puede cambiar esta asignación.', {
        exact: true,
      })
      .waitFor();
    assert.equal(await chooser.page.getByLabel('Personaje disponible').count(), 0);
    assert.equal((await api(chooser.context, '/overview')).data.characterSelection.locked, true);
    await chooser.context.close();
    await master.page.getByRole('button', { name: 'Crear contenido', exact: true }).click();
    const dialog = master.page.getByRole('dialog');
    await dialog.getByLabel('Tipo', { exact: true }).selectOption('idea');
    const title = `Nota de prueba ${Date.now()}`;
    await dialog.getByLabel('Título', { exact: true }).fill(title);
    await dialog
      .getByLabel('Contenido / notas privadas del máster')
      .fill('Una preparación solo para el máster.');
    await dialog.getByRole('button', { name: 'Guardar en privado' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await master.page.getByRole('status').filter({ hasText: 'Contenido guardado' }).waitFor();
    const ov = await api(master.context, '/overview');
    assert.equal(ov.status, 200);
    const char1 = ov.data.characters.find((r: any) => r.title === 'Lira del Umbral');
    const char2 = ov.data.characters.find((r: any) => r.title === 'Bruno de la Bruma');
    assert(char1 && char2);
    const secret = await api(master.context, '/records', 'POST', {
      kind: 'lore',
      title: 'El secreto del farero',
      body: 'SECRETO E2E',
      data: { trueName: 'NO FILTRAR' },
    });
    assert.equal(secret.status, 201);
    const fragment = await api(master.context, `/records/${secret.data.id}/fragments`, 'POST', {
      title: 'Una figura en el muelle',
      body: 'Alguien espera junto a la barca.',
    });
    assert.equal(fragment.status, 201);
    assert.equal(
      (
        await api(master.context, `/fragments/${fragment.data.id}`, 'POST', {
          characters: [char1.id],
          source: 'presenció',
        })
      ).status,
      200,
    );
    const upload = await master.context.request.post(base + '/attachments', {
      headers: { Origin: origin },
      multipart: {
        record_id: secret.data.id,
        fragment_id: fragment.data.id,
        file: {
          name: 'carta-ficticia.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('Carta ficticia de prueba.'),
        },
      },
    });
    assert.equal(upload.status(), 201);
    const file = await upload.json();
    const p1 = await login('lira@example.test', { width: 390, height: 844 }),
      p2 = await login('bruno@example.test');
    assert.equal((await api(p1.context, '/storage')).status, 403);
    assert.equal((await api(p1.context, `/records/${secret.data.id}`)).status, 404);
    assert.equal((await api(p1.context, `/records/${char2.id}`)).status, 404);
    assert.equal((await api(p1.context, `/records/${fragment.data.id}`)).status, 200);
    assert.equal((await api(p2.context, `/records/${fragment.data.id}`)).status, 404);
    assert.equal((await p1.context.request.get(base + `/attachments/${file.id}`)).status(), 200);
    assert.equal((await p2.context.request.get(base + `/attachments/${file.id}`)).status(), 404);
    assert.deepEqual((await api(p2.context, '/records?q=figura')).data, []);
    const read = await api(p1.context, `/records/${char1.id}`);
    const updated = await api(p1.context, `/records/${char1.id}`, 'PATCH', {
      version: read.data.record.version,
      data: { playerNotes: 'Nota guardada desde la prueba HTTP.' },
    });
    assert.equal(updated.status, 200);
    assert.equal(
      (await api(p1.context, `/records/${char1.id}`)).data.record.data.playerNotes,
      'Nota guardada desde la prueba HTTP.',
    );
    assert.equal(
      (
        await api(p2.context, `/records/${char1.id}`, 'PATCH', {
          version: updated.data.version,
          data: { playerNotes: 'Intrusión' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await api(p1.context, `/records/${char1.id}`, 'PATCH', {
          version: read.data.record.version,
          data: { playerNotes: 'Conflicto' },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await master.context.request.post(base + '/records', {
          headers: { Origin: 'https://otro.example' },
          data: { kind: 'lore', title: 'CSRF' },
        })
      ).status(),
      403,
    );
    const preview = await api(master.context, `/overview?as=${char2.id}`);
    assert.equal(preview.status, 200);
    assert(!JSON.stringify(preview.data).includes('SECRETO E2E'));
    assert.equal(
      (
        await api(master.context, `/records?as=${char2.id}`, 'POST', {
          kind: 'lore',
          title: 'No escribir',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await api(master.context, `/fragments/${fragment.data.id}`, 'POST', {
          characters: [char1.id],
          source: 'recibió',
          revoke: true,
        })
      ).status,
      200,
    );
    assert.equal((await p1.context.request.get(base + `/attachments/${file.id}`)).status(), 404);
    const exported = await api(master.context, '/export');
    assert.equal(exported.status, 200);
    assert.equal(exported.data.format, 'aetherfall-1');
    assert(exported.data.files.length > 0);
    assert.equal((await api(p1.context, '/export')).status, 403);
    const roll = await api(p1.context, '/rolls', 'POST', { formula: '2d6+3' });
    assert.equal(roll.status, 201);
    assert(roll.data.total >= 5 && roll.data.total <= 15);
    const thread = await api(master.context, '/threads', 'POST', {
      character_id: char1.id,
      title: 'Una carta entre mareas',
      visible_sender: 'Una mano desconocida',
      real_sender: 'REMITENTE_OCULTO_E2E',
      body: 'No olvides el farol.',
      replies_enabled: true,
      send: true,
    });
    assert.equal(thread.status, 201);
    assert.equal((await api(p2.context, `/threads/${thread.data.id}`)).status, 404);
    const correspondence = await api(p1.context, `/threads/${thread.data.id}`);
    assert.equal(correspondence.status, 200);
    assert(!JSON.stringify(correspondence.data).includes('REMITENTE_OCULTO_E2E'));
    assert.equal(
      (
        await api(p1.context, `/threads/${thread.data.id}/reply`, 'POST', {
          body: 'Volveré al muelle.',
        })
      ).status,
      200,
    );
    const journal = await api(p1.context, '/journals', 'POST', {
      character_id: char1.id,
      type: 'bitácora',
      title: 'Lo que me guardo',
      body: 'Un borrador personal.',
    });
    assert.equal(journal.status, 201);
    assert(
      !(await api(master.context, '/journals')).data.some((j: any) => j.id === journal.data.id),
    );
    assert.equal(
      (
        await api(p1.context, `/journals/${journal.data.id}`, 'PATCH', {
          version: 1,
          title: 'Lo que recuerdo',
          body: 'Una interpretación compartida.',
          shared_master: true,
          recipients: [],
        })
      ).status,
      200,
    );
    assert(
      (await api(master.context, '/journals')).data.some((j: any) => j.id === journal.data.id),
    );
    assert(!(await api(p2.context, '/journals')).data.some((j: any) => j.id === journal.data.id));
    assert.equal(
      (
        await api(master.context, '/commerce/wallets', 'POST', {
          character_id: char1.id,
          amount: '100',
          idempotency_key: crypto.randomUUID(),
        })
      ).status,
      200,
    );
    const product = await api(master.context, '/commerce/products', 'POST', {
      private_name: 'Nombre secreto de prueba',
      known_name: 'Una cantimplora',
      shop_name: 'El puesto del muelle',
      stock: 1,
      base_price: '10',
      private_notes: 'PROPIEDAD_OCULTA_E2E',
    });
    assert.equal(product.status, 201);
    assert.equal(
      (
        await api(master.context, `/commerce/catalog/${product.data.id}`, 'POST', {
          characters: [char1.id],
          offered_price: '10',
          stock_visibility: 'disponible',
        })
      ).status,
      200,
    );
    const catalog = await api(p1.context, '/commerce');
    assert(!JSON.stringify(catalog.data).includes('PROPIEDAD_OCULTA_E2E'));
    assert(
      !(await api(p2.context, '/commerce')).data.products.some(
        (p: any) => p.id === product.data.id,
      ),
    );
    const purchase = await api(p1.context, '/commerce/purchases', 'POST', {
      character_id: char1.id,
      product_id: product.data.id,
      quantity: 1,
      idempotency_key: crypto.randomUUID(),
    });
    assert.equal(purchase.status, 201);
    assert.equal(
      (await api(master.context, `/commerce/purchases/${purchase.data.id}`, 'POST', {})).status,
      201,
    );
    assert.equal(
      (await api(master.context, `/commerce/purchases/${purchase.data.id}`, 'POST', {})).status,
      201,
    );
    assert.equal(
      (await api(p1.context, '/commerce')).data.inventory
        .filter((i: any) => i.name === 'Una cantimplora')
        .at(-1).quantity,
      1,
    );
    const integration = await api(master.context, '/integrations', 'POST', {
      name: 'Prueba temporal',
      scopes: ['draft'],
    });
    assert.equal(integration.status, 201);
    const external = await browser.newContext();
    const auth = { Authorization: 'Bearer ' + integration.data.token };
    const draft = await external.request.post(base + '/records', {
      headers: auth,
      data: { kind: 'idea', title: 'Idea de integración de prueba', status: 'vigente' },
    });
    assert.equal(draft.status(), 201);
    assert.equal((await draft.json()).status, 'borrador');
    assert.equal((await external.request.get(base + '/overview', { headers: auth })).status(), 403);
    assert.equal(
      (
        await external.request.post(base + `/fragments/${fragment.data.id}`, {
          headers: auth,
          data: { characters: [char2.id], source: 'recibió' },
        })
      ).status(),
      403,
    );
    assert.equal(
      (await api(master.context, `/integrations/${integration.data.id}`, 'DELETE')).status,
      200,
    );
    assert.equal(
      (
        await external.request.post(base + '/records', {
          headers: auth,
          data: { kind: 'idea', title: 'Revocada' },
        })
      ).status(),
      401,
    );
    await external.close();
    await master.page.getByRole('button', { name: 'Correspondencia', exact: true }).click();
    await master.page.getByRole('heading', { name: 'Correspondencia privada' }).waitFor();
    await master.page.getByRole('button', { name: 'Inventario y tiendas', exact: true }).click();
    await master.page.getByRole('heading', { name: 'Objetos en custodia' }).waitFor();
    await master.page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await mkdir('docs/capturas', { recursive: true });
    await master.page.reload();
    await master.page
      .getByRole('heading', { name: 'Todo listo para la próxima historia.' })
      .waitFor();
    await master.page.screenshot({ path: 'docs/capturas/master.png', fullPage: true });
    await p1.page.reload();
    await p1.page.getByRole('heading', { name: 'Antes de volver a jugar.' }).waitFor();
    await p1.page.screenshot({ path: 'docs/capturas/jugador-movil.png', fullPage: true });
    assert(
      await p1.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      'Sin desbordamiento horizontal en celular',
    );
    await master.page.getByRole('button', { name: 'Archivo', exact: true }).click();
    await master.page.getByLabel('Buscar contenido autorizado').fill(title);
    await master.page.getByRole('button').filter({ hasText: title }).click();
    await master.page.getByRole('dialog').waitFor();
    await master.page.keyboard.press('Escape');
    await master.page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(errors, [], 'Sin errores de JavaScript en el navegador');
    console.log(
      'E2E_OK: ingreso por enlace compartido sin registrar correos, elección única persistente, acceso por correo de un uso, creación desde UI, dos jugadores, permisos API/adjuntos/búsqueda, ficha persistente, conflictos, CSRF, vista personaje, revocación, exportación, dados, bitácoras, correspondencia, compras atómicas, credenciales revocables y celular.',
    );
    await Promise.all([master.context.close(), p1.context.close(), p2.context.close()]);
  } finally {
    await browser.close();
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
