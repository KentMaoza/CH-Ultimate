ALTER TABLE nota_pages
  ADD UNIQUE INDEX IF NOT EXISTS uq_nota_pages_id_nota (id, nota_id);

ALTER TABLE nota_lines
  ADD CONSTRAINT fk_nota_lines_page_nota
  FOREIGN KEY IF NOT EXISTS (page_id, nota_id)
  REFERENCES nota_pages (id, nota_id);
