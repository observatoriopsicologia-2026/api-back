create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null default 'admin' check (role in ('admin', 'editor')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists publications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  abstract text not null default '',
  authors text not null default '',
  year integer,
  country text not null default '',
  tags text[] not null default '{}',
  file_path text,
  file_name text,
  file_mime text,
  file_size integer,
  is_featured boolean not null default false,
  published_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists researchers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  institution text not null default '',
  country text not null default '',
  specialty text not null default '',
  bio text not null default '',
  email text not null default '',
  profile_url text not null default '',
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  starts_at timestamptz,
  location text not null default '',
  modality text not null default 'Presencial',
  category text not null default '',
  url text not null default '',
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null default '',
  body text not null default '',
  image_url text not null default '',
  source_url text not null default '',
  published_at date,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  type text not null default 'Enlace',
  url text not null default '',
  tags text[] not null default '{}',
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dataset_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text not null default '',
  publication_date date,
  year integer,
  language text[] not null default '{}',
  document_type text not null default 'Documento',
  source_org text not null default '',
  topic text not null default '',
  batch text not null default '',
  source_url text not null default '',
  local_file text not null default '',
  extracted_text text not null default '',
  manual_notes text not null default '',
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dataset_documents enable row level security;

create unique index if not exists dataset_documents_source_idx
on dataset_documents (topic, batch, local_file);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = '';

drop trigger if exists set_users_updated_at on users;
create trigger set_users_updated_at
before update on users
for each row execute function set_updated_at();

drop trigger if exists set_publications_updated_at on publications;
create trigger set_publications_updated_at
before update on publications
for each row execute function set_updated_at();

drop trigger if exists set_researchers_updated_at on researchers;
create trigger set_researchers_updated_at
before update on researchers
for each row execute function set_updated_at();

drop trigger if exists set_events_updated_at on events;
create trigger set_events_updated_at
before update on events
for each row execute function set_updated_at();

drop trigger if exists set_news_updated_at on news;
create trigger set_news_updated_at
before update on news
for each row execute function set_updated_at();

drop trigger if exists set_resources_updated_at on resources;
create trigger set_resources_updated_at
before update on resources
for each row execute function set_updated_at();

drop trigger if exists set_dataset_documents_updated_at on dataset_documents;
create trigger set_dataset_documents_updated_at
before update on dataset_documents
for each row execute function set_updated_at();

create index if not exists publications_search_idx on publications using gin (
  to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(abstract, '') || ' ' || coalesce(authors, ''))
);

create index if not exists news_search_idx on news using gin (
  to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body, ''))
);

create index if not exists dataset_documents_search_idx on dataset_documents using gin (
  to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(author, '') || ' ' || coalesce(topic, '') || ' ' || coalesce(source_org, '') || ' ' || coalesce(manual_notes, ''))
);

create index if not exists dataset_documents_topic_idx on dataset_documents (topic);
create index if not exists dataset_documents_year_idx on dataset_documents (year);
