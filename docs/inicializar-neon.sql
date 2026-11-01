-- Aetherfall: estructura de base de datos. No crea cuentas ni carga datos de demostración.
-- Ejecutar completo en el editor SQL de la base de producción elegida.
-- Cada migración queda registrada y no se repite si ya fue aplicada.
BEGIN;
CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
DO $aetherfall$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='001_core.sql') THEN
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text, email_verified timestamptz, image text);
CREATE TABLE verification_tokens (identifier text NOT NULL, token text NOT NULL UNIQUE, expires timestamptz NOT NULL, PRIMARY KEY(identifier,token));
CREATE TABLE campaigns (id uuid PRIMARY KEY, name text NOT NULL, group_name text NOT NULL, demo boolean NOT NULL DEFAULT false, world_time text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE members (campaign_id uuid REFERENCES campaigns ON DELETE CASCADE, user_id uuid REFERENCES users, role text NOT NULL CHECK(role IN ('master','player')), active boolean NOT NULL DEFAULT true, PRIMARY KEY(campaign_id,user_id));
CREATE TABLE invitations (id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns, email text NOT NULL, role text NOT NULL CHECK(role IN ('master','player')), expires timestamptz NOT NULL, accepted_at timestamptz, UNIQUE(campaign_id,email));
CREATE TABLE folders (id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns, parent_id uuid REFERENCES folders, name text NOT NULL, UNIQUE(campaign_id,id));
CREATE TABLE records (id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns, kind text NOT NULL, title text NOT NULL, body text NOT NULL DEFAULT '', data jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'vigente', folder_id uuid, owner_id uuid REFERENCES users, version integer NOT NULL DEFAULT 1, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(campaign_id,id), FOREIGN KEY(campaign_id,folder_id) REFERENCES folders(campaign_id,id));
CREATE TABLE fragments (id uuid PRIMARY KEY, campaign_id uuid NOT NULL, record_id uuid NOT NULL, title text NOT NULL, body text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(campaign_id,id), FOREIGN KEY(campaign_id,record_id) REFERENCES records(campaign_id,id));
CREATE TABLE grants (campaign_id uuid NOT NULL, fragment_id uuid NOT NULL, character_id uuid NOT NULL, source text NOT NULL CHECK(source IN ('presenció','le contaron','leyó','recibió')), granted_at timestamptz NOT NULL DEFAULT now(), opened_at timestamptz, PRIMARY KEY(fragment_id,character_id), FOREIGN KEY(campaign_id,fragment_id) REFERENCES fragments(campaign_id,id), FOREIGN KEY(campaign_id,character_id) REFERENCES records(campaign_id,id));
CREATE TABLE attachments (id uuid PRIMARY KEY, campaign_id uuid NOT NULL, record_id uuid NOT NULL, fragment_id uuid, name text NOT NULL, mime text NOT NULL, size integer NOT NULL, object_key text NOT NULL UNIQUE, sha256 text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(campaign_id,record_id) REFERENCES records(campaign_id,id), FOREIGN KEY(campaign_id,fragment_id) REFERENCES fragments(campaign_id,id));
CREATE TABLE record_links (campaign_id uuid NOT NULL, source_id uuid NOT NULL, target_id uuid NOT NULL, PRIMARY KEY(source_id,target_id), FOREIGN KEY(campaign_id,source_id) REFERENCES records(campaign_id,id), FOREIGN KEY(campaign_id,target_id) REFERENCES records(campaign_id,id));
CREATE TABLE revisions (id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns, record_id uuid NOT NULL REFERENCES records, version integer NOT NULL, snapshot jsonb NOT NULL, actor_id uuid REFERENCES users, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(record_id,version));
CREATE TABLE audit (id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns, actor_id uuid REFERENCES users, action text NOT NULL, target_id uuid, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE rate_limits (key text PRIMARY KEY, hits integer NOT NULL, resets_at timestamptz NOT NULL);
CREATE INDEX records_campaign ON records(campaign_id,kind) WHERE deleted_at IS NULL;
CREATE INDEX grants_character ON grants(character_id);
CREATE INDEX attachments_record ON attachments(record_id);
CREATE INDEX audit_campaign ON audit(campaign_id,created_at DESC);

    INSERT INTO schema_migrations(name) VALUES('001_core.sql');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='002_community_commerce.sql') THEN
CREATE TABLE journals (id uuid PRIMARY KEY, campaign_id uuid NOT NULL, character_id uuid NOT NULL, author_id uuid NOT NULL REFERENCES users, type text NOT NULL CHECK(type IN ('bitácora','momento','intención')), title text NOT NULL, body text NOT NULL DEFAULT '', significance text NOT NULL DEFAULT '', change_text text NOT NULL DEFAULT '', explore text NOT NULL DEFAULT '', session_id uuid, shared_master boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(campaign_id,id), FOREIGN KEY(campaign_id,character_id) REFERENCES records(campaign_id,id), FOREIGN KEY(campaign_id,session_id) REFERENCES records(campaign_id,id));
CREATE TABLE journal_recipients (campaign_id uuid NOT NULL, journal_id uuid NOT NULL, character_id uuid NOT NULL, PRIMARY KEY(journal_id,character_id), FOREIGN KEY(campaign_id,journal_id) REFERENCES journals(campaign_id,id), FOREIGN KEY(campaign_id,character_id) REFERENCES records(campaign_id,id));
CREATE TABLE threads (id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns, character_id uuid NOT NULL, visible_sender text NOT NULL, real_sender text NOT NULL DEFAULT '', title text NOT NULL, replies_enabled boolean NOT NULL DEFAULT false, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(campaign_id,id), FOREIGN KEY(campaign_id,character_id) REFERENCES records(campaign_id,id));
CREATE TABLE thread_messages (id uuid PRIMARY KEY, campaign_id uuid NOT NULL, thread_id uuid NOT NULL, author_id uuid NOT NULL REFERENCES users, from_master boolean NOT NULL, body text NOT NULL, opened_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(campaign_id,thread_id) REFERENCES threads(campaign_id,id));
CREATE TABLE currencies (id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns, name text NOT NULL, symbol text NOT NULL, base_units bigint NOT NULL CHECK(base_units>0), UNIQUE(campaign_id,symbol));
CREATE TABLE wallets (campaign_id uuid NOT NULL, character_id uuid PRIMARY KEY, balance bigint NOT NULL DEFAULT 0 CHECK(balance>=0), version integer NOT NULL DEFAULT 1, FOREIGN KEY(campaign_id,character_id) REFERENCES records(campaign_id,id));
CREATE TABLE products (id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns, private_name text NOT NULL, known_name text NOT NULL, shop_name text NOT NULL, description text NOT NULL DEFAULT '', private_notes text NOT NULL DEFAULT '', stock integer NOT NULL CHECK(stock>=0), base_price bigint NOT NULL CHECK(base_price>=0), version integer NOT NULL DEFAULT 1, UNIQUE(campaign_id,id));
CREATE TABLE catalog_grants (campaign_id uuid NOT NULL, product_id uuid NOT NULL, character_id uuid NOT NULL, offered_price bigint NOT NULL CHECK(offered_price>=0), stock_visibility text NOT NULL CHECK(stock_visibility IN ('exacta','aproximada','disponible')), PRIMARY KEY(product_id,character_id), FOREIGN KEY(campaign_id,product_id) REFERENCES products(campaign_id,id), FOREIGN KEY(campaign_id,character_id) REFERENCES records(campaign_id,id));
CREATE TABLE purchases (id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns, character_id uuid NOT NULL, product_id uuid NOT NULL, requested_by uuid NOT NULL REFERENCES users, quantity integer NOT NULL CHECK(quantity>0), unit_price bigint NOT NULL CHECK(unit_price>=0), state text NOT NULL CHECK(state IN ('pendiente','confirmada','rechazada')), idempotency_key uuid NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(campaign_id,character_id) REFERENCES records(campaign_id,id), FOREIGN KEY(campaign_id,product_id) REFERENCES products(campaign_id,id));
CREATE TABLE inventory_items (id uuid PRIMARY KEY, campaign_id uuid NOT NULL, character_id uuid NOT NULL, name text NOT NULL, description text NOT NULL DEFAULT '', quantity integer NOT NULL CHECK(quantity>=0), source text NOT NULL, private_notes text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1, FOREIGN KEY(campaign_id,character_id) REFERENCES records(campaign_id,id));
CREATE TABLE movements (id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns, character_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES users, type text NOT NULL, amount bigint NOT NULL DEFAULT 0, item_id uuid REFERENCES inventory_items, quantity integer, idempotency_key uuid NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(campaign_id,character_id) REFERENCES records(campaign_id,id));
CREATE INDEX journal_author ON journals(campaign_id,author_id) WHERE deleted_at IS NULL;
CREATE INDEX threads_recipient ON threads(campaign_id,character_id);
CREATE INDEX inventory_character ON inventory_items(campaign_id,character_id);

    INSERT INTO schema_migrations(name) VALUES('002_community_commerce.sql');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='003_idempotency.sql') THEN
CREATE TABLE operation_keys (key uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns, actor_id uuid NOT NULL REFERENCES users, operation text NOT NULL);

    INSERT INTO schema_migrations(name) VALUES('003_idempotency.sql');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='004_integrations.sql') THEN
CREATE TABLE integration_tokens (id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns, user_id uuid NOT NULL REFERENCES users, name text NOT NULL, token_hash text NOT NULL UNIQUE, scopes text[] NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());

    INSERT INTO schema_migrations(name) VALUES('004_integrations.sql');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name='005_campaign_integrity.sql') THEN
ALTER TABLE folders ADD CONSTRAINT folders_parent_campaign FOREIGN KEY(campaign_id,parent_id) REFERENCES folders(campaign_id,id);
ALTER TABLE fragments ADD CONSTRAINT fragments_record_identity UNIQUE(campaign_id,id,record_id);
ALTER TABLE attachments ADD CONSTRAINT attachments_fragment_record FOREIGN KEY(campaign_id,fragment_id,record_id) REFERENCES fragments(campaign_id,id,record_id);

    INSERT INTO schema_migrations(name) VALUES('005_campaign_integrity.sql');
  END IF;
END
$aetherfall$;
COMMIT;

SELECT name, applied_at FROM schema_migrations ORDER BY name;
