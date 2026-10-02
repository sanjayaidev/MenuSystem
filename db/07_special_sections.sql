-- Category-specific Special section videos and five featured menu references.
-- Run after db/06_site_settings.sql.

begin;

create table if not exists special_sections (
  category_id bigint primary key references categories(id) on delete cascade,
  video_path text,
  updated_at timestamptz not null default now()
);

create table if not exists special_section_items (
  category_id bigint not null references categories(id) on delete cascade,
  slot int not null check (slot between 1 and 5),
  menu_item_id bigint not null references menu_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (category_id, slot),
  unique (category_id, menu_item_id)
);

alter table special_sections enable row level security;
alter table special_section_items enable row level security;

commit;