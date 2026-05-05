export interface BaseItem {
  id: string;
  is_featured?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Publication extends BaseItem {
  title: string;
  abstract: string;
  authors: string;
  year?: number | null;
  country: string;
  tags: string[];
  file_path?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  published_at?: string | null;
}

export interface Researcher extends BaseItem {
  name: string;
  institution: string;
  country: string;
  specialty: string;
  bio: string;
  email: string;
  profile_url: string;
}

export interface EventItem extends BaseItem {
  title: string;
  description: string;
  starts_at?: string | null;
  location: string;
  modality: string;
  category: string;
  url: string;
}

export interface NewsItem extends BaseItem {
  title: string;
  summary: string;
  body: string;
  image_url: string;
  source_url: string;
  published_at?: string | null;
}

export interface ResourceItem extends BaseItem {
  title: string;
  description: string;
  type: string;
  url: string;
  tags: string[];
}

export interface ApiList<T> {
  items: T[];
}

export interface ApiItem<T> {
  item: T;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'editor';
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export type CollectionKey = 'publications' | 'researchers' | 'events' | 'news' | 'resources';

