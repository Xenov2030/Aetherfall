ALTER TABLE folders ADD CONSTRAINT folders_parent_campaign FOREIGN KEY(campaign_id,parent_id) REFERENCES folders(campaign_id,id);
ALTER TABLE fragments ADD CONSTRAINT fragments_record_identity UNIQUE(campaign_id,id,record_id);
ALTER TABLE attachments ADD CONSTRAINT attachments_fragment_record FOREIGN KEY(campaign_id,fragment_id,record_id) REFERENCES fragments(campaign_id,id,record_id);
