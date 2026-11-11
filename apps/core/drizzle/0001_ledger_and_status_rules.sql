-- xp_events is a ledger: rows are added, never edited or removed.
CREATE OR REPLACE FUNCTION xp_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'xp_events is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER xp_events_no_update_delete
  BEFORE UPDATE OR DELETE ON xp_events
  FOR EACH ROW EXECUTE FUNCTION xp_events_append_only();
--> statement-breakpoint
-- Public things start as drafts and move draft -> approved -> published,
-- one step at a time. Moving back to an earlier status is allowed.
CREATE OR REPLACE FUNCTION publish_status_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION '% rows must start as draft, got %', TG_TABLE_NAME, NEW.status;
    END IF;
  ELSIF (OLD.status = 'draft' AND NEW.status = 'published')
     OR (OLD.status = 'published' AND NEW.status = 'approved') THEN
    RAISE EXCEPTION '% status cannot move from % to %', TG_TABLE_NAME, OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER content_items_status_guard
  BEFORE INSERT OR UPDATE OF status ON content_items
  FOR EACH ROW EXECUTE FUNCTION publish_status_guard();
--> statement-breakpoint
CREATE TRIGGER posts_status_guard
  BEFORE INSERT OR UPDATE OF status ON posts
  FOR EACH ROW EXECUTE FUNCTION publish_status_guard();
