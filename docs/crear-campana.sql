-- Aetherfall: ejecutar después de inicializar-neon.sql.
-- Reemplazar REEMPLAZAR_CORREO_MASTER por el correo real del máster.
-- No crea cuentas de jugadores ni concede descubrimientos.
BEGIN;
DO $aetherfall$
DECLARE
  v_email text := lower('REEMPLAZAR_CORREO_MASTER');
  v_campaign uuid;
  v_user uuid;
  v_folder uuid;
  v_record uuid;
  v_name text;
  v_folders jsonb := '{}';
  v_entry record;
BEGIN
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Indicá un correo real válido del máster antes de ejecutar.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('aetherfall-inicializacion'));
  IF (SELECT count(*) FROM campaigns WHERE name='Aetherfall' AND demo=false) > 1 THEN
    RAISE EXCEPTION 'Ya hay varias campañas con ese nombre; revisalas sin reemplazar datos.';
  END IF;
  SELECT id INTO v_campaign FROM campaigns WHERE name='Aetherfall' AND demo=false;
  IF v_campaign IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM members m JOIN users u ON u.id=m.user_id WHERE m.campaign_id=v_campaign AND lower(u.email)=v_email AND m.role='master' AND m.active=true) THEN
      RAISE EXCEPTION 'La campaña ya existe y no se modificó su propietario ni sus accesos.';
    END IF;
    RETURN;
  END IF;
  IF (SELECT count(*) FROM users WHERE lower(email)=v_email)>1 THEN
    RAISE EXCEPTION 'Hay identidades duplicadas para ese correo; revisalas antes de continuar.';
  END IF;
  SELECT id INTO v_user FROM users WHERE lower(email)=v_email;
  IF v_user IS NULL THEN
    v_user := gen_random_uuid();
    INSERT INTO users(id,email,name) VALUES(v_user,v_email,'Máster');
  END IF;
  v_campaign := gen_random_uuid();
  INSERT INTO campaigns(id,name,group_name,demo) VALUES(v_campaign,'Aetherfall','La Banda Viajera',false);
  INSERT INTO members(campaign_id,user_id,role,active) VALUES(v_campaign,v_user,'master',true);
  FOREACH v_name IN ARRAY ARRAY['Sesiones','Personajes','Mundo','NPC','Villanos','Reliquias','Mecánicas','Ideas pendientes'] LOOP
    v_folder := gen_random_uuid();
    INSERT INTO folders(id,campaign_id,name) VALUES(v_folder,v_campaign,v_name);
    v_folders := v_folders || jsonb_build_object(v_name,v_folder);
  END LOOP;
  FOR v_entry IN SELECT * FROM (VALUES
    ('character','Aldrich Ironhart','Javier Agustín Reka','Personajes'),
    ('character','Corvin Dorian','Facundo','Personajes'),
    ('character','Toren Hearthlight','Lucho','Personajes'),
    ('character','Arlen Greyfang','Rama','Personajes'),
    ('character','Timo Vhalder','Lucas','Personajes'),
    ('lore','Hollow Creek',NULL,'Mundo'),
    ('lore','Ashford',NULL,'Mundo'),
    ('lore','Taberna El Ciervo y la Lanza',NULL,'Mundo'),
    ('npc','Edrik Vhal',NULL,'NPC')
  ) AS initial_data(kind,title,player_label,folder_name) LOOP
    v_record := gen_random_uuid();
    INSERT INTO records(id,campaign_id,kind,title,status,folder_id,data)
    VALUES(v_record,v_campaign,v_entry.kind,v_entry.title,'borrador',(v_folders->>v_entry.folder_name)::uuid,
      CASE WHEN v_entry.kind='character' THEN jsonb_build_object('playerLabel',v_entry.player_label,'sheet','{}'::jsonb,'editable','[]'::jsonb) ELSE '{}'::jsonb END);
    INSERT INTO revisions(id,campaign_id,record_id,version,snapshot,actor_id)
      SELECT gen_random_uuid(),v_campaign,id,version,to_jsonb(r),v_user FROM records r WHERE id=v_record;
  END LOOP;
  INSERT INTO audit(id,campaign_id,actor_id,action,target_id)
    VALUES(gen_random_uuid(),v_campaign,v_user,'inicializar-campaña',v_campaign);
END
$aetherfall$;
COMMIT;

SELECT c.name AS campana,c.group_name AS grupo,u.email AS correo_master,m.role AS rol,
  (SELECT count(*) FROM records r WHERE r.campaign_id=c.id AND r.kind='character') AS personajes,
  (SELECT count(*) FROM records r WHERE r.campaign_id=c.id) AS entradas,
  (SELECT count(*) FROM grants g WHERE g.campaign_id=c.id) AS revelaciones
FROM campaigns c JOIN members m ON m.campaign_id=c.id JOIN users u ON u.id=m.user_id
WHERE c.name='Aetherfall' AND c.demo=false AND m.role='master' AND m.active=true;
