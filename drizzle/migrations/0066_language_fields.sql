-- PLA-I2-10: what the owner typed for an order ("Pedido de … desde …: «…»") is a field, not a sentence the server
-- parses back. The screen writes it when it creates an order or an idea; orderText() reads it first and falls back to
-- the old Spanish scope line for rows written before this migration (left as they are: words stored stay as written).
-- The owner's request for changes needs no column: it rides on the note event's payload (owner_changes).
-- Safe to run twice. Never applied by an agent to a real database.

alter table tasks add column if not exists owner_words text;
