CREATE TABLE operation_keys (key uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns, actor_id uuid NOT NULL REFERENCES users, operation text NOT NULL);
