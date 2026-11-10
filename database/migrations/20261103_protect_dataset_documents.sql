-- Direct anonymous access is blocked; the Node API connects as the table owner.
alter table public.dataset_documents enable row level security;
