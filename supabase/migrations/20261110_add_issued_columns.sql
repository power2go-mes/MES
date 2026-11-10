-- Add non-breaking issuance columns to all inventory entity tables:
-- cells, bms_units, bmu_units, modules, batteries, and racks.

-- 1. Cells
alter table public.cells
    add column if not exists issued_to_person text default null,
    add column if not exists issued_to_department text default null,
    add column if not exists issued_by text default null,
    add column if not exists issued_at timestamptz default null;

-- 2. BMS Units
alter table public.bms_units
    add column if not exists issued_to_person text default null,
    add column if not exists issued_to_department text default null,
    add column if not exists issued_by text default null,
    add column if not exists issued_at timestamptz default null;

-- 3. BMU Units
alter table public.bmu_units
    add column if not exists issued_to_person text default null,
    add column if not exists issued_to_department text default null,
    add column if not exists issued_by text default null,
    add column if not exists issued_at timestamptz default null;

-- 4. Modules
alter table public.modules
    add column if not exists issued_to_person text default null,
    add column if not exists issued_to_department text default null,
    add column if not exists issued_by text default null,
    add column if not exists issued_at timestamptz default null;

-- 5. Batteries (Packs)
alter table public.batteries
    add column if not exists issued_to_person text default null,
    add column if not exists issued_to_department text default null,
    add column if not exists issued_by text default null,
    add column if not exists issued_at timestamptz default null;

-- 6. Racks
alter table public.racks
    add column if not exists issued_to_person text default null,
    add column if not exists issued_to_department text default null,
    add column if not exists issued_by text default null,
    add column if not exists issued_at timestamptz default null;

-- Indexes for fast query of issued items
create index if not exists idx_cells_issued_to on public.cells (issued_to_person) where issued_to_person is not null;
create index if not exists idx_bms_issued_to on public.bms_units (issued_to_person) where issued_to_person is not null;
create index if not exists idx_bmu_issued_to on public.bmu_units (issued_to_person) where issued_to_person is not null;
create index if not exists idx_modules_issued_to on public.modules (issued_to_person) where issued_to_person is not null;
create index if not exists idx_batteries_issued_to on public.batteries (issued_to_person) where issued_to_person is not null;
create index if not exists idx_racks_issued_to on public.racks (issued_to_person) where issued_to_person is not null;

