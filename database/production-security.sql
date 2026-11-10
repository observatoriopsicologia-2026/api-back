-- The Node API owns authentication. These roles must not bypass it via the Data API.
-- Review and run once in the target Supabase project before public deployment.
begin;

alter function public.set_updated_at() set search_path = '';

alter table public.users enable row level security;
alter table public.publications enable row level security;
alter table public.researchers enable row level security;
alter table public.events enable row level security;
alter table public.news enable row level security;
alter table public.resources enable row level security;
alter table public.dataset_documents enable row level security;

revoke all privileges on table
  public.users,
  public.publications,
  public.researchers,
  public.events,
  public.news,
  public.resources,
  public.dataset_documents
from anon, authenticated;

commit;
