-- ================================================================
-- POWER2GO MES - AUTHORITATIVE SCHEMA
-- ================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ================================================================
-- 1. ENUMS
-- ================================================================

do $$ begin
    create type cell_status as enum ('IMPORTED', 'ACKNOWLEDGED', 'OCV_TESTED', 'GRADED', 'AVAILABLE', 'RESERVED', 'MODULE_ASSIGNED', 'QUARANTINED', 'REJECTED', 'IN_PROCESS', 'ASSEMBLED', 'VALIDATING', 'TESTING', 'SCANNED', 'PASSED');
exception when duplicate_object then null; end $$;

do $$ begin
    create type module_status as enum ('CREATED', 'CELLS_ASSIGNED', 'ASSEMBLED', 'WELDED', 'QC', 'PASSED', 'FAILED', 'QUARANTINED');
exception when duplicate_object then null; end $$;

do $$ begin
    create type battery_status as enum ('CREATED', 'ASSEMBLY', 'TESTING', 'QC', 'RELEASED', 'WAREHOUSE', 'DISPATCHED', 'FINISHED', 'IN_PROCESS', 'QUARANTINED');
exception when duplicate_object then null; end $$;

do $$ begin
    create type order_status as enum ('PLANNED', 'IN_PROCESS', 'COMPLETED', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
    create type quarantine_status as enum ('OPEN', 'RESOLVED');
exception when duplicate_object then null; end $$;

do $$ begin
    create type controller_status as enum ('AVAILABLE', 'ASSIGNED', 'QUARANTINED', 'ARCHIVED', 'FAILED', 'PASSED');
exception when duplicate_object then null; end $$;

do $$ begin
    create type import_status as enum ('PENDING', 'COMPLETED', 'FAILED');
exception when duplicate_object then null; end $$;

-- ================================================================
-- 2. AUTH & RBAC (Unified single authority)
-- ================================================================

create table if not exists public.roles (
    id text primary key,
    name text not null,
    description text,
    status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.permissions (
    id text primary key,
    name text not null,
    description text,
    resource text not null,
    action text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
    role_id text not null references public.roles(id) on delete cascade,
    permission_id text not null references public.permissions(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (role_id, permission_id)
);

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text,
    email text unique,
    username text unique,
    role_id text references public.roles(id) on delete restrict,
    badge_id text unique,
    status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles(role_id);
create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_role_permissions_role on public.role_permissions(role_id);

-- Unified Permission Helper
create or replace function public.has_permission(required_permission text)
returns boolean as $$
declare
    user_role_id text;
    role_exists boolean;
begin
    select role_id into user_role_id from public.profiles where id = auth.uid() and status = 'ACTIVE';
    if user_role_id is null then return false; end if;
    select exists(select 1 from public.roles where id = user_role_id) into role_exists;
    if not role_exists then return false; end if;
    if exists (
        select 1 from public.role_permissions
        where role_id = user_role_id
        and (permission_id = required_permission or permission_id = 'ALL')
    ) then return true; end if;
    return false;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.require_permission(required_permission text)
returns void as $$
begin
    if auth.uid() is null or not public.has_permission(required_permission) then
        raise exception 'Permission denied: %', required_permission using errcode = '42501';
    end if;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.email_for_username(p_username text)
returns text as $$
declare
        result_email text;
begin
        select email into result_email from public.profiles
        where lower(username) = lower(trim(p_username)) and status = 'ACTIVE' limit 1;
        return result_email;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.email_for_username(text) from public;
grant execute on function public.email_for_username(text) to anon, authenticated;

create or replace function public.handle_new_auth_user()
returns trigger as $$
declare
    assigned_role text;
begin
    assigned_role := case
        when lower(new.email) in ('admin@gmail.com', 'admin@power2go.com') then 'role-admin'
        when (new.raw_user_meta_data->>'role_id') in ('role-admin', 'role-operator') then new.raw_user_meta_data->>'role_id'
        else 'role-operator'
    end;
    insert into public.profiles (id, full_name, email, username, role_id, status)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), new.email, coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)), assigned_role, 'ACTIVE')
    on conflict (id) do update set email = excluded.email, role_id = case when excluded.role_id = 'role-admin' then 'role-admin' else public.profiles.role_id end, updated_at = now();
    return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();
-- ================================================================
-- 3. MASTER DATA
-- ================================================================

create table if not exists public.product_templates (
    id text primary key,
    sku text not null unique,
    name text not null,
    product_model text not null default '',
    battery_name text not null default '',
    voltage_type text not null default 'LV' check (voltage_type in ('LV', 'HV')),
    nominal_voltage_v numeric not null,
    capacity_kwh numeric not null,
    total_capacity_ah numeric not null,
    num_modules integer not null,
    cells_per_module integer not null,
    total_cells integer not null,
    bms_model text not null,
    bms_protocol text not null,
    bms_config_json jsonb not null default '{}'::jsonb,
    bmu_config_json jsonb not null default '{}'::jsonb,
    grading_rules_json jsonb not null default '{}'::jsonb,
    qc_stages text[] not null default array[]::text[],
    serial_prefix text not null,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.product_templates add column if not exists battery_name text;
alter table public.product_templates add column if not exists module_configurations_json jsonb not null default '[]'::jsonb;
alter table public.product_templates add column if not exists product_model text;
alter table public.product_templates add column if not exists voltage_type text;
update public.product_templates set product_model = coalesce(nullif(product_model, ''), sku) where product_model is null or product_model = '';
update public.product_templates set battery_name = coalesce(nullif(battery_name, ''), name) where battery_name is null or battery_name = '';
alter table public.product_templates alter column product_model set default '';
update public.product_templates set voltage_type = 'LV' where voltage_type is null or voltage_type not in ('LV', 'HV');
alter table public.product_templates alter column battery_name set default '';
alter table public.product_templates alter column voltage_type set default 'LV';
alter table public.product_templates alter column battery_name set not null;
alter table public.product_templates alter column product_model set not null;
alter table public.product_templates alter column voltage_type set not null;
alter table public.product_templates drop constraint if exists product_templates_voltage_type_check;
alter table public.product_templates add constraint product_templates_voltage_type_check check (voltage_type in ('LV', 'HV'));

create table if not exists public.suppliers (
    id text primary key,
    name text not null unique,
    contact_email text,
    status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.machine_configurations (
    id text primary key,
    name text not null,
    type text not null check (type in ('OCV_TESTER', 'LASER_WELDER', 'BMS_TESTER', 'EOL_TESTER', 'ROBOTIC_ARM', 'CONVEYOR')),
    ip_address text,
    status text not null default 'OFFLINE' check (status in ('ONLINE', 'OFFLINE', 'MAINTENANCE', 'BUSY')),
    settings_json jsonb not null default '{}'::jsonb,
    last_ping_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ================================================================
-- 4. QR REGISTRY (Centralized Identifiers)
-- ================================================================
create table if not exists public.qr_registry (
    qr_code text primary key,
    entity_type text not null check (entity_type in ('CELL', 'MODULE', 'BATTERY', 'BMS', 'BMU')),
    entity_id text not null,
    registered_at timestamptz not null default now()
);

create index if not exists idx_qr_registry_entity on public.qr_registry(entity_type, entity_id);

-- ================================================================
-- 5. IMPORTS & PRODUCTION ORDERS
-- ================================================================

create table if not exists public.supplier_imports (
    id text primary key,
    supplier_id text references public.suppliers(id) on delete restrict,
    filename text not null,
    total_rows integer not null default 0,
    imported_rows integer not null default 0,
    duplicate_rows integer not null default 0,
    invalid_rows integer not null default 0,
    status import_status not null default 'PENDING',
    imported_by uuid references public.profiles(id) on delete set null,
    imported_at timestamptz not null default now(),
    error_summary_json jsonb not null default '{}'::jsonb
);

create table if not exists public.production_orders (
    id text primary key,
    order_number text not null unique,
    product_id text not null references public.product_templates(id) on delete restrict,
    target_quantity integer not null,
    quantity_in_process integer not null default 0,
    quantity_completed integer not null default 0,
    status order_status not null default 'PLANNED',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- ================================================================
-- 6. CONTROLLERS (BMS & BMU)
-- ================================================================

create table if not exists public.bms_units (
    id text primary key,
    serial_number text not null unique,
    model text not null,
    supplier text not null,
    hardware_version text,
    firmware_version text,
    protocol text not null,
    status controller_status not null default 'AVAILABLE',
    reserved_for_battery_id text, -- fk added later to avoid circular
    test_result_json jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.bmu_units (
    id text primary key,
    serial_number text not null unique,
    model text not null,
    manufacturer text not null,
    protocol text not null,
    status controller_status not null default 'AVAILABLE',
    reserved_for_battery_id text, -- fk added later
    test_result_json jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.bms_units add column if not exists manufacturer text;
alter table public.bms_units add column if not exists batch_number text;
alter table public.bmu_units add column if not exists batch_number text;

create unique index if not exists idx_bms_active_battery on public.bms_units(reserved_for_battery_id) where reserved_for_battery_id is not null;
create unique index if not exists idx_bmu_active_battery on public.bmu_units(reserved_for_battery_id) where reserved_for_battery_id is not null;

-- ================================================================
-- 7. BATTERIES & MODULES
-- ================================================================

create table if not exists public.batteries (
    id text primary key,
    serial_number text not null unique,
    production_order_id text not null references public.production_orders(id) on delete restrict,
    product_id text not null references public.product_templates(id) on delete restrict,
    bms_id text references public.bms_units(id) on delete set null,
    bmu_id text references public.bmu_units(id) on delete set null,
    current_step text not null default 'START',
    status battery_status not null default 'CREATED',
    progress_percent integer not null default 0,
    step_results_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.bms_units drop constraint if exists fk_bms_battery;
alter table public.bms_units add constraint fk_bms_battery foreign key (reserved_for_battery_id) references public.batteries(id) on delete set null;

alter table public.bmu_units drop constraint if exists fk_bmu_battery;
alter table public.bmu_units add constraint fk_bmu_battery foreign key (reserved_for_battery_id) references public.batteries(id) on delete set null;

create table if not exists public.modules (
    id text primary key,
    battery_id text references public.batteries(id) on delete cascade,
    production_order_id text references public.production_orders(id) on delete cascade,
    module_index integer,
    serial_number text unique,
    status module_status not null default 'CREATED',
    welding_result_json jsonb,
    qc_result_json jsonb,
    matching_score numeric not null default 0,
    matching_metrics jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (battery_id, module_index)
);

alter table public.modules add column if not exists module_type text;
alter table public.modules add column if not exists lifecycle_status text default 'IN_MODULE';
do $$ begin
    alter table public.modules add constraint modules_lifecycle_status_check
        check (lifecycle_status in ('IN_STOCK','IN_MODULE','IN_PACK','IN_RACK','SOLD','SCRAP'));
exception when duplicate_object then null;
end $$;

alter table public.modules add column if not exists welding_result_json jsonb;
alter table public.modules add column if not exists qc_result_json jsonb;
alter table public.modules add column if not exists matching_score numeric;
alter table public.modules add column if not exists matching_metrics jsonb;
alter table public.modules add column if not exists module_type text;
update public.modules set matching_score = coalesce(matching_score, 0) where matching_score is null;
update public.modules set matching_metrics = coalesce(matching_metrics, '{}'::jsonb) where matching_metrics is null;
alter table public.modules alter column matching_score set default 0;
alter table public.modules alter column matching_metrics set default '{}'::jsonb;
alter table public.modules alter column matching_score set not null;
alter table public.modules alter column matching_metrics set not null;

-- ================================================================
-- 8. CELLS & MODULE CELLS
-- ================================================================

create table if not exists public.cells (
    id text primary key,
    internal_serial text not null unique,
    supplier_barcode text,
    qr_code text unique,
    supplier_id text references public.suppliers(id) on delete restrict,
    import_id text references public.supplier_imports(id) on delete restrict,
    batch_number text,
    pallet_number text,
    box_number text,
    supplier_ocv_v numeric,
    supplier_ir_mohm numeric,
    production_ocv_v numeric,
    production_ir_mohm numeric,
    grade text,
    status cell_status not null default 'IMPORTED',
    reserved_for_order_id text references public.production_orders(id) on delete set null,
    reserved_for_battery_id text references public.batteries(id) on delete set null,
    tested_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.cells add column if not exists lifecycle_status text default 'IN_STOCK';
do $$ begin
    alter table public.cells add constraint cells_lifecycle_status_check
        check (lifecycle_status in ('IN_STOCK','FLOOR_STOCK','IN_MODULE','IN_PACK','IN_RACK','SOLD','SCRAP'));
exception when duplicate_object then null;
end $$;

-- Relational linkage of cells into modules (No JSON arrays)
create table if not exists public.module_cells (
    module_id text not null references public.modules(id) on delete cascade,
    cell_id text not null references public.cells(id) on delete restrict,
    cell_slot_index integer not null,
    assigned_at timestamptz not null default now(),
    primary key (module_id, cell_id),
    unique (cell_id), -- A cell can only be in one module slot ever
    unique (module_id, cell_slot_index) -- A module slot can only hold one cell
);

-- Indexes for scaling to 100k+ cells
create index if not exists idx_cells_status on public.cells(status);
create index if not exists idx_cells_internal_serial on public.cells(internal_serial);
create index if not exists idx_cells_supplier_barcode on public.cells(supplier_barcode);
create index if not exists idx_cells_order on public.cells(reserved_for_order_id);
create index if not exists idx_cells_battery on public.cells(reserved_for_battery_id);
create index if not exists idx_cells_import on public.cells(import_id);
create index if not exists idx_modules_battery on public.modules(battery_id);
create index if not exists idx_batteries_order on public.batteries(production_order_id);
-- ================================================================
-- 9. QUALITY & TESTS
-- ================================================================

create table if not exists public.cell_tests (
    id text primary key,
    cell_id text not null references public.cells(id) on delete cascade,
    battery_id text references public.batteries(id) on delete set null,
    test_type text not null check (test_type in ('OCV_IR', 'GRADING', 'CAPACITY')),
    ocv_v numeric,
    ir_mohm numeric,
    temperature_c numeric,
    grade text,
    passed boolean not null,
    remarks text,
    tested_by uuid references public.profiles(id) on delete set null,
    tested_at timestamptz not null default now()
);

alter table public.cell_tests
    alter column id set default ('ctest-' || gen_random_uuid()::text);

create table if not exists public.module_tests (
    id text primary key,
    module_id text not null references public.modules(id) on delete cascade,
    test_type text not null check (test_type in ('WELDING_INSPECTION', 'OCV', 'ISOLATION', 'QC')),
    passed boolean not null,
    result_json jsonb not null default '{}'::jsonb,
    remarks text,
    tested_by uuid references public.profiles(id) on delete set null,
    tested_at timestamptz not null default now()
);

alter table public.module_tests drop constraint if exists module_tests_test_type_check;
alter table public.module_tests add constraint module_tests_test_type_check
    check (test_type in ('WELDING_INSPECTION', 'OCV', 'ISOLATION', 'QC'));

create table if not exists public.controller_tests (
    id text primary key,
    controller_type text not null check (controller_type in ('BMS', 'BMU')),
    controller_id text not null,
    battery_id text references public.batteries(id) on delete set null,
    test_type text not null check (test_type in ('FIRMWARE_CHECK', 'COMMUNICATION', 'CALIBRATION')),
    passed boolean not null,
    result_json jsonb not null default '{}'::jsonb,
    tested_by uuid references public.profiles(id) on delete set null,
    tested_at timestamptz not null default now()
);

create table if not exists public.battery_tests (
    id text primary key,
    battery_id text not null references public.batteries(id) on delete cascade,
    test_type text not null check (test_type in ('EOL', 'CHARGE_DISCHARGE', 'LEAK_TEST')),
    passed boolean not null,
    result_json jsonb not null default '{}'::jsonb,
    remarks text,
    tested_by uuid references public.profiles(id) on delete set null,
    tested_at timestamptz not null default now()
);

create table if not exists public.quarantine_records (
    id text primary key,
    entity_type text not null check (entity_type in ('CELL', 'MODULE', 'BATTERY', 'BMS', 'BMU')),
    entity_id text not null,
    reason text not null,
    status quarantine_status not null default 'OPEN',
    quarantined_by uuid references public.profiles(id) on delete set null,
    quarantined_at timestamptz not null default now(),
    resolved_by uuid references public.profiles(id) on delete set null,
    resolved_at timestamptz,
    disposed_of_as text,
    disposition_notes text,
    image_uri text
);

-- ================================================================
-- 10. WAREHOUSE & DISPATCH
-- ================================================================

create table if not exists public.warehouse_movements (
    id text primary key,
    entity_type text not null check (entity_type in ('CELL', 'MODULE', 'BATTERY', 'BMS', 'BMU')),
    entity_id text not null,
    movement_type text not null check (movement_type in ('RECEIVE', 'MOVE', 'DISPATCH', 'RETURN')),
    from_location text,
    to_location text,
    reference text,
    moved_by uuid references public.profiles(id) on delete set null,
    moved_at timestamptz not null default now()
);

create table if not exists public.release_records (
    id text primary key,
    battery_id text not null references public.batteries(id) on delete cascade,
    released_by uuid references public.profiles(id) on delete set null,
    released_at timestamptz not null default now(),
    release_notes text,
    checklist_json jsonb not null default '{}'::jsonb
);

create table if not exists public.dispatches (
    id text primary key,
    battery_id text not null references public.batteries(id) on delete restrict,
    dispatch_reference text not null,
    destination text not null,
    dispatched_by uuid references public.profiles(id) on delete set null,
    dispatched_at timestamptz not null default now()
);

create table if not exists public.supplier_import_rows (
    id text primary key,
    import_id text not null references public.supplier_imports(id) on delete cascade,
    raw_data_json jsonb not null,
    status text not null check (status in ('IMPORTED', 'DUPLICATE', 'INVALID')),
    error_message text,
    created_at timestamptz not null default now()
);

create index if not exists idx_cell_tests_cell on public.cell_tests(cell_id);
create index if not exists idx_quarantine_entity on public.quarantine_records(entity_type, entity_id);
create index if not exists idx_quarantine_status on public.quarantine_records(status);
create index if not exists idx_warehouse_entity on public.warehouse_movements(entity_type, entity_id);
-- ================================================================
-- 11. AUDIT LOGGING & GENEALOGY
-- ================================================================

create table if not exists public.audit_logs (
    id text primary key default uuid_generate_v4()::text,
    entity_type text not null,
    entity_id text not null,
    action text not null,
    actor text not null, -- usually auth.uid()
    timestamp timestamptz not null default now(),
    result text not null,
    before_state jsonb,
    after_state jsonb,
    details text
);

create index if not exists idx_audit_logs_entity on public.audit_logs(entity_type, entity_id);
create index if not exists idx_audit_logs_timestamp on public.audit_logs(timestamp desc);

-- Enforce append-only nature of audit_logs
create or replace function public.reject_audit_mutation()
returns trigger as $$
begin
    raise exception 'audit_logs is append-only';
end;
$$ language plpgsql;

drop trigger if exists trg_reject_audit_mutation on public.audit_logs;
create trigger trg_reject_audit_mutation
    before update or delete on public.audit_logs
    for each row execute function public.reject_audit_mutation();


create table if not exists public.genealogy_records (
    id text primary key default uuid_generate_v4()::text,
    entity_type text not null check (entity_type in ('CELL', 'MODULE', 'BATTERY', 'BMS', 'BMU')),
    entity_id text not null,
    event_type text not null,
    parent_entity_type text,
    parent_entity_id text,
    event_data jsonb not null default '{}'::jsonb,
    recorded_at timestamptz not null default now(),
    recorded_by uuid references public.profiles(id) on delete set null
);

create index if not exists idx_genealogy_entity on public.genealogy_records(entity_type, entity_id);
create index if not exists idx_genealogy_parent on public.genealogy_records(parent_entity_type, parent_entity_id);

-- Helper to record genealogy
create or replace function public.record_genealogy_event(
    p_entity_type text,
    p_entity_id text,
    p_event_type text,
    p_parent_type text default null,
    p_parent_id text default null,
    p_event_data jsonb default '{}'::jsonb
) returns void as $$
begin
    insert into public.genealogy_records (
        entity_type, entity_id, event_type, parent_entity_type, parent_entity_id, event_data, recorded_by
    ) values (
        p_entity_type, p_entity_id, p_event_type, p_parent_type, p_parent_id, p_event_data, auth.uid()
    );
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.record_genealogy_event(text, text, text, text, text, jsonb) from public;
revoke all on function public.record_genealogy_event(text, text, text, text, text, jsonb) from anon;
-- ================================================================
-- 12. RPCs & STATE MACHINE FUNCTIONS
-- ================================================================

-- ASSIGN A SCANNED STANDALONE MODULE TO A BATTERY SLOT
create or replace function public.assign_module_to_battery_transaction(
    p_battery_id text,
    p_module_barcode text,
    p_module_index integer
) returns jsonb as $$
declare
    v_battery record;
    v_module record;
    v_placeholder_id text;
begin
    perform public.require_permission('MANAGE_PRODUCTION');

    select * into v_battery
    from public.batteries
    where id = p_battery_id
    for update;
    if not found then
        raise exception 'Battery % not found', p_battery_id;
    end if;
    if p_module_index is null or p_module_index < 0 then
        raise exception 'A valid battery module slot is required';
    end if;

    select m.* into v_module
    from public.modules m
    where (m.id = trim(p_module_barcode)
        or lower(m.serial_number) = lower(trim(p_module_barcode))
        or exists (
            select 1 from public.qr_registry q
            where q.entity_type = 'MODULE'
              and q.entity_id = m.id
              and lower(q.qr_code) = lower(trim(p_module_barcode))
        ))
    for update;
    if not found then
        raise exception 'Module % not found', p_module_barcode;
    end if;
    if v_module.battery_id is not null and v_module.battery_id <> p_battery_id then
        raise exception 'Module % is already assigned to another battery', v_module.serial_number;
    end if;
    if v_module.battery_id = p_battery_id then
        return jsonb_build_object('success', true, 'module', to_jsonb(v_module));
    end if;
    if v_module.status <> 'PASSED' then
        raise exception 'Module % is not complete. Complete module OCV, grading, damage history, welding, and QC before pack assignment', v_module.serial_number;
    end if;

    select id into v_placeholder_id
    from public.modules
    where battery_id = p_battery_id
      and module_index = p_module_index
      and id <> v_module.id
    for update;
    if v_placeholder_id is not null then
        if exists (select 1 from public.module_cells where module_id = v_placeholder_id) then
            raise exception 'Battery module slot % is already occupied', p_module_index;
        end if;
        delete from public.modules where id = v_placeholder_id;
    end if;

    update public.modules
    set battery_id = p_battery_id,
        production_order_id = v_battery.production_order_id,
        module_index = p_module_index,
        lifecycle_status = 'IN_PACK',
        updated_at = now()
    where id = v_module.id;

    update public.cells
    set reserved_for_battery_id = p_battery_id,
        lifecycle_status = 'IN_PACK',
        updated_at = now()
    where id in (select cell_id from public.module_cells where module_id = v_module.id);

    perform public.record_genealogy_event('MODULE', v_module.id, 'ASSIGNED_TO_BATTERY', 'BATTERY', p_battery_id);
    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values ('MODULE', v_module.id, 'ASSIGN_MODULE_TO_BATTERY', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Assigned module to battery slot ' || p_module_index);

    select * into v_module from public.modules where id = v_module.id;
    return jsonb_build_object('success', true, 'module', to_jsonb(v_module));
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.assign_module_to_battery_transaction(text, text, integer) to authenticated;

-- BULK SUPPLIER IMPORT
create or replace function public.import_supplier_cells_bulk(
    p_filename text,
    p_supplier_name text,
    p_rows jsonb
) returns jsonb as $$
declare
    v_supplier_id text;
    v_import_id text;
    v_total integer;
    v_imported integer := 0;
    v_duplicates integer := 0;
    v_row record;
    v_cell_id text;
    v_qr_code text;
    v_internal text;
begin
    perform public.require_permission('MANAGE_INVENTORY');
    -- 1. Resolve/Create Supplier
    select id into v_supplier_id from public.suppliers where name = p_supplier_name;
    if v_supplier_id is null then
        v_supplier_id := 'sup-' || extract(epoch from now())::bigint::text;
        insert into public.suppliers (id, name) values (v_supplier_id, p_supplier_name);
    end if;

    -- 2. Create Import Record
    v_import_id := 'imp-' || gen_random_uuid()::text;
    v_total := jsonb_array_length(p_rows);
    insert into public.supplier_imports (id, supplier_id, filename, total_rows, imported_rows, duplicate_rows, status, imported_by)
    values (v_import_id, v_supplier_id, p_filename, v_total, 0, 0, 'PENDING', auth.uid());

    -- 3. Process Rows (Set-based UPSERT equivalent or loop)
    -- Using a loop for precise duplicate handling/QR registry integration
    for v_row in select * from jsonb_to_recordset(p_rows) as x(internal_serial text, supplier_barcode text, ocv numeric, ir numeric, batch_number text, pallet_number text, box_number text) loop
        v_internal := v_row.internal_serial;
        if v_internal is null then continue; end if;

        -- Check if exists
        if exists (select 1 from public.cells where internal_serial = v_internal) then
            v_duplicates := v_duplicates + 1;
        else
            v_cell_id := 'cell-' || v_internal;
            v_qr_code := coalesce(v_row.supplier_barcode, v_internal);
            
            insert into public.qr_registry (qr_code, entity_type, entity_id) values (v_qr_code, 'CELL', v_cell_id) on conflict do nothing;

            insert into public.cells (
                id, internal_serial, supplier_barcode, qr_code, supplier_id, import_id,
                batch_number, pallet_number, box_number, supplier_ocv_v, supplier_ir_mohm, status, lifecycle_status
            ) values (
                v_cell_id, v_internal, v_row.supplier_barcode, v_qr_code, v_supplier_id, v_import_id,
                v_row.batch_number, v_row.pallet_number, v_row.box_number, v_row.ocv, v_row.ir, 'IMPORTED', 'IN_STOCK'
            );
            
            -- GENEALOGY EVENT: Record cell import
            perform public.record_genealogy_event(
                'CELL', v_cell_id, 'IMPORTED', null, null,
                jsonb_build_object('supplier_id', v_supplier_id, 'import_id', v_import_id)
            );
            
            v_imported := v_imported + 1;
        end if;
    end loop;

    -- 4. Finalize
    update public.supplier_imports 
    set imported_rows = v_imported, duplicate_rows = v_duplicates, status = 'COMPLETED'
    where id = v_import_id;

    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values ('IMPORT', v_import_id, 'BULK_IMPORT', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', v_imported || ' imported, ' || v_duplicates || ' duplicates');

    return jsonb_build_object(
        'importId', v_import_id,
        'total', v_total,
        'imported', v_imported,
        'duplicates', v_duplicates
    );
end;
$$ language plpgsql security definer;

-- CREATE A STANDALONE MODULE FROM FLOOR STOCK CELLS
create or replace function public.create_standalone_module_transaction(
    p_module_type text,
    p_cell_barcodes text[]
) returns jsonb as $$
declare
    v_module_id text := 'mod-' || gen_random_uuid()::text;
    v_serial text := 'MOD-' || upper(replace(p_module_type, ' ', '')) || '-' || to_char(now(), 'YYYYMMDDHH24MISSMS');
    v_required integer;
    v_cells jsonb;
    v_cell record;
    v_index integer := 0;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    if upper(p_module_type) not in ('8S', '12S') then
        raise exception 'Module type must be 8S or 12S';
    end if;
    v_required := case when upper(p_module_type) = '8S' then 8 else 12 end;
    if coalesce(array_length(p_cell_barcodes, 1), 0) <> v_required then
        raise exception 'A % module requires exactly % cells', upper(p_module_type), v_required;
    end if;
    if (select count(distinct value) from unnest(p_cell_barcodes) as value) <> v_required then
        raise exception 'Duplicate cell barcodes are not allowed';
    end if;

    select jsonb_agg(to_jsonb(c) order by array_position(p_cell_barcodes, coalesce(c.internal_serial, c.id)))
      into v_cells
      from public.cells c
     where (coalesce(c.internal_serial, c.id) = any(p_cell_barcodes)
         or c.supplier_barcode = any(p_cell_barcodes)
         or c.qr_code = any(p_cell_barcodes))
       and c.status not in ('QUARANTINED', 'REJECTED')
       and c.lifecycle_status = 'FLOOR_STOCK'
       and c.reserved_for_order_id is null
       and c.reserved_for_battery_id is null;

    if coalesce(jsonb_array_length(v_cells), 0) <> v_required then
        raise exception 'Every scanned cell must be unique and in FLOOR_STOCK';
    end if;

    insert into public.modules (
        id,
        battery_id,
        production_order_id,
        module_index,
        serial_number,
        module_type,
        status,
        lifecycle_status,
        matching_score,
        matching_metrics,
        welding_result_json,
        qc_result_json
    )
    values (
        v_module_id,
        null,
        null,
        null,
        v_serial,
        upper(p_module_type),
        'PASSED',
        'IN_STOCK',
        100,
        jsonb_build_object('cellCount', v_required, 'acknowledged', true, 'qualityWorkflow', 'PASSED'),
        jsonb_build_object('status', 'PASSED', 'physicalVisualOk', true, 'voltageQcOk', true, 'inspectedAt', now(), 'inspectorId', coalesce(auth.uid()::text, 'SYSTEM'), 'notes', 'Imported and completed during module upload'),
        jsonb_build_object('status', 'PASSED', 'welded_at', now(), 'operator_id', coalesce(auth.uid()::text, 'SYSTEM'), 'notes', 'Imported and completed during module upload', 'laserPowerWatts', 2800, 'weldTimeMs', 4200, 'pullForceKg', 18.5)
    );

    for v_cell in
        select c.id, row_number() over (order by array_position(p_cell_barcodes, coalesce(c.internal_serial, c.id))) - 1 as slot
          from public.cells c
         where (coalesce(c.internal_serial, c.id) = any(p_cell_barcodes)
             or c.supplier_barcode = any(p_cell_barcodes)
             or c.qr_code = any(p_cell_barcodes))
    loop
        insert into public.module_cells (module_id, cell_id, cell_slot_index)
        values (v_module_id, v_cell.id, v_cell.slot);
        update public.cells
           set status = 'PASSED', lifecycle_status = 'IN_MODULE', updated_at = now()
         where id = v_cell.id;
        insert into public.cell_tests (id, cell_id, battery_id, test_type, ocv_v, ir_mohm, grade, passed, remarks, tested_by, tested_at)
        values ('ctest-' || gen_random_uuid()::text, v_cell.id, null, 'OCV_IR', 0, 0, null, true, 'Imported module final validation', auth.uid(), now());
        insert into public.cell_tests (id, cell_id, battery_id, test_type, grade, passed, remarks, tested_by, tested_at)
        values ('ctest-' || gen_random_uuid()::text, v_cell.id, null, 'GRADING', 'A+', true, 'Imported module final validation', auth.uid(), now());
        insert into public.module_tests (id, module_id, test_type, passed, result_json, remarks, tested_by, tested_at)
        values ('mtest-' || gen_random_uuid()::text, v_module_id, 'WELDING_INSPECTION', true, '{}'::jsonb, 'Imported module final validation', auth.uid(), now());
        insert into public.module_tests (id, module_id, test_type, passed, result_json, remarks, tested_by, tested_at)
        values ('mtest-' || gen_random_uuid()::text, v_module_id, 'QC', true, '{}'::jsonb, 'Imported module final validation', auth.uid(), now());
        perform public.record_genealogy_event(
                'CELL', v_cell.id, 'ASSIGNED_TO_MODULE', 'MODULE', v_module_id,
                jsonb_build_object('module_type', upper(p_module_type), 'cell_slot_index', v_cell.slot)
        );
    end loop;

    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values ('MODULE', v_module_id, 'CREATE_STANDALONE_MODULE', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', upper(p_module_type) || ' module imported and fully qualified from floor-stock cells');

    insert into public.qr_registry (qr_code, entity_type, entity_id)
    values (v_serial || '|MODULE:' || v_module_id, 'MODULE', v_module_id)
    on conflict (qr_code) do nothing;

    return jsonb_build_object(
        'module', jsonb_build_object('id', v_module_id, 'serial_number', v_serial, 'module_type', upper(p_module_type), 'status', 'PASSED', 'qr_code', v_serial || '|MODULE:' || v_module_id),
        'cells', v_cells
    );
end;
$$ language plpgsql security definer;

grant execute on function public.create_standalone_module_transaction(text, text[]) to authenticated;

-- COMPLETE A STANDALONE MODULE QUALITY WORKFLOW
create or replace function public.complete_standalone_module_transaction(
    p_module_id text,
    p_acknowledged boolean,
    p_cells jsonb
) returns jsonb as $$
declare
    v_module record;
    v_cell record;
    v_cell_count integer;
    v_test_count integer := 0;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    if not p_acknowledged then
        raise exception 'Module build acknowledgement is required';
    end if;

    select * into v_module from public.modules where id = p_module_id for update;
    if not found then
        raise exception 'Module % not found', p_module_id;
    end if;

    select count(*) into v_cell_count from public.module_cells where module_id = p_module_id;
    if v_cell_count not in (8, 12) then
        raise exception 'Module must contain exactly 8 or 12 cells';
    end if;
    if coalesce(jsonb_array_length(p_cells), 0) <> v_cell_count then
        raise exception 'Complete OCV, grading, and damage history for every module cell';
    end if;

    for v_cell in select * from jsonb_to_recordset(p_cells) as x(
        cell_id text,
        ocv_v numeric,
        ir_mohm numeric,
        grade text,
        damage_condition text,
        damage_remarks text
    ) loop
        if v_cell.ocv_v is null or v_cell.ir_mohm is null then
            raise exception 'OCV and IR are required for every cell';
        end if;
        if nullif(trim(v_cell.grade), '') is null then
            raise exception 'A grade is required for every cell';
        end if;
        if upper(coalesce(v_cell.damage_condition, '')) not in ('GOOD', 'OK') then
            raise exception 'Damaged cells cannot complete module assembly';
        end if;
        if not exists (
            select 1 from public.module_cells
            where module_id = p_module_id and cell_id = v_cell.cell_id
        ) then
            raise exception 'Cell % is not assigned to this module', v_cell.cell_id;
        end if;

        update public.cells
        set production_ocv_v = v_cell.ocv_v,
            production_ir_mohm = v_cell.ir_mohm,
            grade = v_cell.grade,
            tested_at = now(),
            status = 'PASSED',
            lifecycle_status = 'IN_MODULE',
            updated_at = now()
        where id = v_cell.cell_id;

        insert into public.cell_tests (id, cell_id, battery_id, test_type, ocv_v, ir_mohm, grade, passed, remarks, tested_by, tested_at)
        values ('ctest-' || gen_random_uuid()::text, v_cell.cell_id, null, 'OCV_IR', v_cell.ocv_v, v_cell.ir_mohm, null, true, v_cell.damage_remarks, auth.uid(), now());
        insert into public.cell_tests (id, cell_id, battery_id, test_type, grade, passed, remarks, tested_by, tested_at)
        values ('ctest-' || gen_random_uuid()::text, v_cell.cell_id, null, 'GRADING', v_cell.grade, true, v_cell.damage_remarks, auth.uid(), now());
        insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
        values ('CELL', v_cell.cell_id, 'MODULE_DAMAGE_HISTORY', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Condition: ' || v_cell.damage_condition || coalesce('; ' || v_cell.damage_remarks, ''));
        v_test_count := v_test_count + 1;
    end loop;

    update public.modules
    set status = 'PASSED',
        lifecycle_status = 'IN_STOCK',
        matching_score = 100,
        matching_metrics = jsonb_build_object('cellCount', v_test_count, 'acknowledged', true, 'qualityWorkflow', 'PASSED'),
        qc_result_json = jsonb_build_object('status', 'PASSED', 'acknowledgedAt', now(), 'completedBy', auth.uid(), 'cellCount', v_test_count),
        updated_at = now()
    where id = p_module_id;

    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values ('MODULE', p_module_id, 'COMPLETE_STANDALONE_MODULE', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Acknowledgement, OCV/IR, grading, and damage history completed');

    select * into v_module from public.modules where id = p_module_id;
    return jsonb_build_object('module', to_jsonb(v_module), 'success', true);
end;
$$ language plpgsql security definer;

grant execute on function public.complete_standalone_module_transaction(text, boolean, jsonb) to authenticated;

-- GET DASHBOARD SUMMARY
create or replace function public.get_dashboard_summary()
returns jsonb as $$
declare
    v_res jsonb;
begin
    select jsonb_build_object(
        'inventory', jsonb_build_object(
            'totalCells', (select count(*) from public.cells),
            'usedCells', (select count(*) from public.cells where status <> 'IMPORTED' or reserved_for_order_id is not null or reserved_for_battery_id is not null),
            'availableCells', (select count(*) from public.cells where status in ('AVAILABLE','IMPORTED','ACKNOWLEDGED','OCV_TESTED','GRADED') and reserved_for_order_id is null and reserved_for_battery_id is null),
            'reservedCells', (select count(*) from public.cells where status = 'RESERVED' or reserved_for_order_id is not null),
            'inProcessCells', (select count(*) from public.cells where status in ('IN_PROCESS','VALIDATING','TESTING','SCANNED','PASSED')),
            'assembledCells', (select count(*) from public.cells where status = 'ASSEMBLED' or exists (select 1 from public.module_cells mc where mc.cell_id = cells.id)),
            'quarantinedCells', (select count(*) from public.cells where status = 'QUARANTINED'),
            'finishedBatteries', (select count(*) from public.batteries where status in ('FINISHED','RELEASED','DISPATCHED')),
            'inProcessBatteries', (select count(*) from public.batteries where status in ('IN_PROCESS','ASSEMBLY','TESTING','QC','CREATED')),
            'availableBms', (select count(*) from public.bms_units where status = 'AVAILABLE' and reserved_for_battery_id is null),
            'availableBmu', (select count(*) from public.bmu_units where status = 'AVAILABLE' and reserved_for_battery_id is null),
            'totalBms', (select count(*) from public.bms_units),
            'totalBmu', (select count(*) from public.bmu_units)
        ),
        'quality', jsonb_build_object(
            'quarantinedCount', (select count(*) from public.quarantine_records where status = 'OPEN'),
            'firstPassYieldPercent', coalesce(round(100.0 * (select count(*) from public.battery_tests where passed = true)::numeric / nullif((select count(*) from public.battery_tests), 0), 1), 0)
        ),
        'orders', jsonb_build_object(
            'total', (select count(*) from public.production_orders),
            'inProcess', (select count(*) from public.production_orders where status = 'IN_PROCESS'),
            'completed', (select count(*) from public.production_orders where status = 'COMPLETED'),
            'planned', (select count(*) from public.production_orders where status = 'PLANNED')
        ),
        'recentBatteries', coalesce((select jsonb_agg(jsonb_build_object(
            'id', recent.id,
            'serialNumber', recent.serial_number,
            'productName', recent.name,
            'currentStep', recent.current_step,
            'progressPercent', recent.progress_percent,
            'status', recent.status
        ) order by recent.created_at desc)
        from (
            select b.id, b.serial_number, p.name, b.current_step, b.progress_percent, b.status, b.created_at
            from public.batteries b
            join public.product_templates p on p.id = b.product_id
            where b.status not in ('RELEASED', 'WAREHOUSE', 'DISPATCHED', 'FINISHED')
            order by b.created_at desc
            limit 20
        ) recent), '[]'::jsonb)
        , 'batteryBuildTrend', coalesce((select jsonb_agg(jsonb_build_object('label', day_label, 'value', amount) order by day_label)
            from (select to_char(created_at, 'YYYY-MM-DD') as day_label, count(*) as amount from public.batteries where status in ('FINISHED','RELEASED','DISPATCHED') group by 1 order by 1 desc limit 7) trend), '[]'::jsonb)
        , 'finishedPackTrend', coalesce((select jsonb_agg(jsonb_build_object('label', day_label, 'value', amount) order by day_label)
            from (select to_char(created_at, 'YYYY-MM-DD') as day_label, count(*) as amount from public.batteries where status in ('FINISHED','RELEASED','DISPATCHED') group by 1 order by 1 desc limit 7) trend), '[]'::jsonb)
        , 'machines', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'status', status) order by name) from public.machine_configurations), '[]'::jsonb)
        , 'bmsTelemetry', jsonb_build_object(
            'total', (select count(*) from public.bms_units),
            'tested', (select count(*) from public.bms_units where test_result_json is not null)
        )
    ) into v_res;
    return v_res;
end;
$$ language plpgsql security definer;


-- ARCHIVE CONTROLLER
create or replace function public.archive_controller_transaction(
    p_controller_type text,
    p_controller_id text
) returns void as $$
begin
    perform public.require_permission('MANAGE_INVENTORY');
    if p_controller_type = 'BMS' then
        update public.bms_units set status = 'ARCHIVED' where id = p_controller_id;
    elsif p_controller_type = 'BMU' then
        update public.bmu_units set status = 'ARCHIVED' where id = p_controller_id;
    else
        raise exception 'Invalid controller type %', p_controller_type;
    end if;
    
    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values (p_controller_type, p_controller_id, 'ARCHIVE', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Controller archived');
end;
$$ language plpgsql security definer;

create or replace function public.delete_controller_transaction(
    p_controller_type text,
    p_controller_id text
) returns void as $$
begin
    perform public.require_permission('MANAGE_INVENTORY');
    if p_controller_type = 'BMS' then
        update public.batteries set bms_id = null where bms_id = p_controller_id;
        delete from public.qr_registry where entity_type = 'BMS' and entity_id = p_controller_id;
        delete from public.genealogy_records
        where (entity_type = 'BMS' and entity_id = p_controller_id)
           or (parent_entity_type = 'BMS' and parent_entity_id = p_controller_id);
        delete from public.bms_units where id = p_controller_id;
    elsif p_controller_type = 'BMU' then
        update public.batteries set bmu_id = null where bmu_id = p_controller_id;
        delete from public.qr_registry where entity_type = 'BMU' and entity_id = p_controller_id;
        delete from public.genealogy_records
        where (entity_type = 'BMU' and entity_id = p_controller_id)
           or (parent_entity_type = 'BMU' and parent_entity_id = p_controller_id);
        delete from public.bmu_units where id = p_controller_id;
    else
        raise exception 'Invalid controller type %', p_controller_type;
    end if;

    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values (p_controller_type, p_controller_id, 'DELETE', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Controller deleted permanently');
end;
$$ language plpgsql security definer;


-- DELETE BATTERY CASCADE
create or replace function public.delete_battery_cascade(
    p_battery_id text
) returns void as $$
declare
    v_order_id text;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    if p_battery_id is null or p_battery_id = '' then
        raise exception 'Battery id is required';
    end if;

    select production_order_id into v_order_id from public.batteries where id = p_battery_id;

    update public.cells
    set status = 'AVAILABLE',
        lifecycle_status = 'FLOOR_STOCK',
        reserved_for_battery_id = null,
        reserved_for_order_id = null
    where reserved_for_battery_id = p_battery_id
       or exists (
           select 1
           from public.module_cells mc
           join public.modules m on m.id = mc.module_id
           where mc.cell_id = public.cells.id
             and m.battery_id = p_battery_id
       );

    delete from public.module_cells where module_id in (
        select id from public.modules where battery_id = p_battery_id
    );

    update public.bms_units
    set reserved_for_battery_id = null,
        status = 'AVAILABLE',
        updated_at = now()
    where reserved_for_battery_id = p_battery_id;

    update public.bmu_units
    set reserved_for_battery_id = null,
        status = 'AVAILABLE',
        updated_at = now()
    where reserved_for_battery_id = p_battery_id;

    update public.batteries
    set bms_id = null,
        bmu_id = null,
        updated_at = now()
    where id = p_battery_id;

    delete from public.modules where battery_id = p_battery_id;
    delete from public.batteries where id = p_battery_id;

    if v_order_id is not null and not exists (select 1 from public.batteries where production_order_id = v_order_id) then
        delete from public.production_orders where id = v_order_id;
    end if;

    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values ('BATTERY', p_battery_id, 'DELETE_CASCADE', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Battery and modules cascade deleted; all linked BMU/BMS assignments released');
end;
$$ language plpgsql security definer;

-- Repair cells left in IN_PACK after older battery deletes that did not reset lifecycle_status.
update public.cells c
set status = 'AVAILABLE', lifecycle_status = 'FLOOR_STOCK', updated_at = now()
where c.lifecycle_status = 'IN_PACK'
    and c.reserved_for_battery_id is null
    and not exists (
            select 1
            from public.module_cells mc
            join public.modules m on m.id = mc.module_id
            where mc.cell_id = c.id
                and m.battery_id is not null
    );


-- CREATE PRODUCTION ORDER
create or replace function public.create_production_order_transaction(
    p_product_id text,
    p_quantity integer,
    p_order_number text,
    p_battery_serial_prefix text default null
) returns jsonb as $$
declare
    v_order_id text;
    v_required_cells integer;
    v_cells_available integer;
    v_cell_ids text[];
    v_battery_ids text[] := array[]::text[];
    v_battery_id text;
    v_battery_serial text;
    v_module_id text;
    v_module_serial text;
    v_serial_prefix text;
    v_product_model text;
    v_battery_name text;
    v_voltage_type text;
    v_capacity_kwh numeric;
    v_serial_base text;
    v_production_period text;
    v_capacity_suffix text;
    v_next_battery_number integer;
    v_next_module_number integer;
    v_serial_override text;
    v_num_modules integer;
    v_cells_per_module integer;
    v_total_cells_per_battery integer;
    v_po_record record;
    v_reserved_cell record;
    v_cell_serial_prefix text;
    v_next_cell_number integer;
    i integer;
    j integer;
    v_cell_slice_ids text[];
begin
    perform public.require_permission('MANAGE_ORDERS');
    if p_product_id is null or nullif(trim(p_product_id), '') is null then
        raise exception 'Product id is required';
    end if;
    if p_quantity is null or p_quantity <= 0 then
        raise exception 'Production quantity must be greater than zero';
    end if;
    if nullif(trim(p_order_number), '') is null then
        raise exception 'Order number is required';
    end if;
    select serial_prefix, product_model, battery_name, voltage_type, capacity_kwh, num_modules, cells_per_module, total_cells
    into v_serial_prefix, v_product_model, v_battery_name, v_voltage_type, v_capacity_kwh, v_num_modules, v_cells_per_module, v_total_cells_per_battery
    from public.product_templates
    where id = p_product_id and active = true;

    if not found then
        raise exception 'Product template % not found or inactive', p_product_id;
    end if;

    v_voltage_type := upper(coalesce(v_voltage_type, case when v_serial_prefix ilike '%HV%' then 'HV' else 'LV' end));
    if v_voltage_type not in ('LV', 'HV') then
        raise exception 'Product template % must specify LV or HV voltage type', p_product_id;
    end if;
    v_product_model := upper(regexp_replace(trim(coalesce(v_product_model, '')), '[^a-zA-Z0-9.]+', '', 'g'));
    if v_product_model = '' then
        raise exception 'Product template % must specify a product model', p_product_id;
    end if;
    v_production_period := to_char(current_date, 'DDMM');
    v_capacity_suffix := regexp_replace(regexp_replace(trim(to_char(coalesce(v_capacity_kwh, 5), 'FM99990.99')), '0+$', '', 'g'), '\.$', '', 'g');
    v_serial_override := trim(coalesce(p_battery_serial_prefix, ''));
    if v_serial_override <> '' then
        if v_serial_override ~ '-[0-9]{1,6}$' then
            v_serial_base := regexp_replace(v_serial_override, '-[0-9]{1,6}$', '');
            v_next_battery_number := coalesce((substring(v_serial_override from '([0-9]+)$'))::integer, 0);
        else
            v_serial_base := v_serial_override;
            v_next_battery_number := 0;
        end if;
    else
        v_serial_base := 'P2G-' || v_product_model || '-' || v_production_period;
        v_next_battery_number := 0;
    end if;
    perform pg_advisory_xact_lock(hashtext('P2G-battery-serials'));
    if v_serial_override = '' then
        select coalesce(max((substring(serial_number from '([0-9]+)$'))::integer), 0) + 1
        into v_next_battery_number
        from public.batteries
        where serial_number ~ '^P2G-[A-Z0-9.]+-[0-9]{4}-[0-9]{6}$';
    end if;
    perform pg_advisory_xact_lock(hashtext('P2G-module-serials')); 
    select coalesce(max((substring(serial_number from '([0-9]+)$'))::integer), 0) + 1
    into v_next_module_number
    from public.modules
    where serial_number like 'P2G-MOD-' || to_char(current_date, 'DDMM') || '-%';

    v_required_cells := v_total_cells_per_battery * p_quantity;

    -- Assign traceable production serials when cells become reserved.
    v_cell_serial_prefix := 'P2G-CL-' || to_char(current_date, 'MMDD');
    perform pg_advisory_xact_lock(hashtext(v_cell_serial_prefix));
    select coalesce(max((substring(internal_serial from '([0-9]+)$'))::integer), 0) + 1
    into v_next_cell_number
    from public.cells
    where internal_serial like v_cell_serial_prefix || '-%';

    select array_agg(id) into v_cell_ids from (
        select id from public.cells
                where status in ('AVAILABLE', 'IMPORTED', 'ACKNOWLEDGED', 'OCV_TESTED', 'GRADED')
                    and lifecycle_status <> 'SCRAP'
                    and reserved_for_order_id is null
                    and reserved_for_battery_id is null
        order by created_at asc
        limit v_required_cells
        for update
    ) x;

    v_cells_available := coalesce(array_length(v_cell_ids, 1), 0);
    if v_cells_available < v_required_cells then
        raise exception 'Insufficient cell inventory to start production order. Required: %, Available: %', v_required_cells, v_cells_available;
    end if;

    v_order_id := coalesce(p_order_number, 'PO-' || extract(epoch from now())::bigint::text);
    insert into public.production_orders (id, order_number, product_id, target_quantity, quantity_in_process, status)
    values (v_order_id, v_order_id, p_product_id, p_quantity, p_quantity, 'IN_PROCESS');

    for i in 1..p_quantity loop
        v_battery_id := 'bat-' || gen_random_uuid()::text;
        v_battery_serial := v_serial_base || '-' || lpad((v_next_battery_number + i - 1)::text, 6, '0');
        v_battery_ids := array_append(v_battery_ids, v_battery_id);

        insert into public.batteries (id, serial_number, production_order_id, product_id, current_step, status, progress_percent, step_results_json)
        values (
            v_battery_id, 
            v_battery_serial, 
            v_order_id, 
            p_product_id, 
            'CELL_IDENTIFICATION', 
            'CREATED', 
            5,
            '{
              "CELL_IDENTIFICATION": {"stepName": "Cell Identification & Verification", "status": "READY", "mode": "AUTO"},
              "CELL_TESTING": {"stepName": "OCV & IR Testing", "status": "PENDING", "mode": "AUTO"},
              "GRADING": {"stepName": "Automatic Cell Grading", "status": "PENDING", "mode": "AUTO"},
              "CELL_MATCHING": {"stepName": "Module Cell Matching", "status": "PENDING", "mode": "AUTO"},
              "MODULE_ASSEMBLY": {"stepName": "Module Assembly", "status": "PENDING", "mode": "MANUAL"},
              "LASER_WELDING": {"stepName": "Laser Busbar Welding", "status": "PENDING", "mode": "AUTO"},
              "MODULE_QC": {"stepName": "Module QC Inspection", "status": "PENDING", "mode": "MANUAL"},
              "BATTERY_ASSEMBLY": {"stepName": "Battery Enclosure Assembly", "status": "PENDING", "mode": "MANUAL"},
              "BMS_INTEGRATION": {"stepName": "BMS Harness & Comms Testing", "status": "PENDING", "mode": "AUTO"},
              "FINAL_TESTING": {"stepName": "Pack High-Pot & Dyn Load Test", "status": "PENDING", "mode": "AUTO"},
              "FINAL_QC": {"stepName": "Final Quality Release & Label", "status": "PENDING", "mode": "MANUAL"}
            }'::jsonb
        );

        for j in 1..v_num_modules loop
            v_module_id := 'mod-' || gen_random_uuid()::text;
            v_module_serial := 'P2G-MOD-' || to_char(current_date, 'DDMM') || '-' || lpad(v_next_module_number::text, 5, '0');
            v_next_module_number := v_next_module_number + 1;
            
            insert into public.modules (id, battery_id, production_order_id, module_index, serial_number, status)
            values (v_module_id, v_battery_id, v_order_id, j - 1, v_module_serial, 'CREATED');
        end loop;

        v_cell_slice_ids := v_cell_ids[((i - 1) * v_total_cells_per_battery + 1) : (i * v_total_cells_per_battery)];
        for j in 1..v_total_cells_per_battery loop
            update public.cells
            set status = 'RESERVED',
                reserved_for_order_id = v_order_id,
                reserved_for_battery_id = v_battery_id
            where id = v_cell_slice_ids[j];
        end loop;
    end loop;

    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values ('ORDER', v_order_id, 'CREATE_PO', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Created order ' || v_order_id || ' for ' || p_quantity || ' batteries');

    select * into v_po_record from public.production_orders where id = v_order_id;

    return jsonb_build_object(
        'order', to_jsonb(v_po_record),
        'batteryIds', to_jsonb(v_battery_ids)
    );
end;
$$ language plpgsql security definer;


-- CREATE A BATTERY SHELL FOR PACK ASSEMBLY
-- Pack Assembly consumes completed standalone modules. It must not reserve cells
-- or create placeholder modules; those records come from Module Assembly.
create or replace function public.create_pack_battery_shell_transaction(
    p_product_id text,
    p_order_number text
) returns jsonb as $$
declare
    v_order_id text := trim(p_order_number);
    v_battery_id text := 'bat-' || gen_random_uuid()::text;
    v_battery_serial text;
    v_product record;
    v_next_number integer;
    v_order record;
    v_battery record;
    v_model text;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    if nullif(trim(p_product_id), '') is null then raise exception 'Product id is required'; end if;
    if nullif(v_order_id, '') is null then raise exception 'Order number is required'; end if;

    select * into v_product from public.product_templates where id = p_product_id and active = true;
    if not found then raise exception 'Product template % not found or inactive', p_product_id; end if;

    v_model := upper(regexp_replace(coalesce(v_product.product_model, v_product.sku), '[^a-zA-Z0-9.]+', '', 'g'));
    perform pg_advisory_xact_lock(hashtext('P2G-battery-serials'));
    select coalesce(max((substring(serial_number from '([0-9]+)$'))::integer), 0) + 1
      into v_next_number
      from public.batteries
     where serial_number like 'P2G-' || v_model || '-%';
    v_battery_serial := 'P2G-' || v_model || '-' || to_char(current_date, 'DDMM') || '-' || lpad(v_next_number::text, 6, '0');

    insert into public.production_orders (id, order_number, product_id, target_quantity, quantity_in_process, status)
    values (v_order_id, v_order_id, p_product_id, 1, 1, 'IN_PROCESS');

    insert into public.batteries (id, serial_number, production_order_id, product_id, current_step, status, progress_percent, step_results_json)
    values (
        v_battery_id, v_battery_serial, v_order_id, p_product_id, 'MODULE_ASSEMBLY', 'CREATED', 40,
        jsonb_build_object(
            'MODULE_ASSEMBLY', jsonb_build_object('stepName', 'Module Assembly', 'status', 'READY', 'mode', 'MANUAL'),
            'BATTERY_ASSEMBLY', jsonb_build_object('stepName', 'Battery Enclosure Assembly', 'status', 'PENDING', 'mode', 'MANUAL'),
            'BMS_INTEGRATION', jsonb_build_object('stepName', 'BMS Harness & Comms Testing', 'status', 'PENDING', 'mode', 'AUTO'),
            'FINAL_TESTING', jsonb_build_object('stepName', 'Pack High-Pot & Dyn Load Test', 'status', 'PENDING', 'mode', 'AUTO'),
            'FINAL_QC', jsonb_build_object('stepName', 'Final Quality Release & Label', 'status', 'PENDING', 'mode', 'MANUAL')
        )
    );

    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values ('BATTERY', v_battery_id, 'CREATE_PACK_BATTERY_SHELL', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Pack shell created; modules come from standalone module assembly');

    select * into v_order from public.production_orders where id = v_order_id;
    select * into v_battery from public.batteries where id = v_battery_id;
    return jsonb_build_object('order', to_jsonb(v_order), 'batteryIds', jsonb_build_array(v_battery_id), 'battery', to_jsonb(v_battery));
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.create_pack_battery_shell_transaction(text, text) to authenticated;


-- ASSIGN CONTROLLER
create or replace function public.assign_controller_transaction(
    p_battery_id text,
    p_controller_type text,
    p_controller_id text,
    p_metadata jsonb
) returns jsonb as $$
declare
    v_bms_record record;
    v_bmu_record record;
    v_battery_record record;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    select * into v_battery_record from public.batteries where id = p_battery_id for update;
    if not found then
        raise exception 'Battery % not found', p_battery_id;
    end if;

    if p_controller_type = 'BMS' then
        select * into v_bms_record from public.bms_units
          where id = trim(p_controller_id)
              or lower(trim(serial_number)) = lower(trim(p_controller_id))
          for update;

        if not found then
            raise exception 'BMS % not found', p_controller_id;
        end if;

        if v_bms_record.status = 'QUARANTINED' then
            raise exception 'BMS % is quarantined', v_bms_record.serial_number;
        end if;

        if v_bms_record.reserved_for_battery_id is not null and v_bms_record.reserved_for_battery_id <> p_battery_id then
            raise exception 'BMS % is already assigned to battery %', v_bms_record.serial_number, v_bms_record.reserved_for_battery_id;
        end if;

        update public.bms_units
        set reserved_for_battery_id = p_battery_id,
            status = 'ASSIGNED',
            updated_at = now()
        where id = v_bms_record.id;

        update public.batteries
        set bms_id = v_bms_record.id,
            updated_at = now()
        where id = p_battery_id;

        insert into public.qr_registry (qr_code, entity_type, entity_id)
        values (v_bms_record.serial_number, 'BMS', v_bms_record.id)
        on conflict (qr_code) do nothing;

        perform public.record_genealogy_event('BMS', v_bms_record.id, 'ASSIGNED_TO_BATTERY', 'BATTERY', p_battery_id);

        insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
        values ('BATTERY', p_battery_id, 'ASSIGN_BMS', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Assigned BMS ' || v_bms_record.serial_number);

        select * into v_battery_record from public.batteries where id = p_battery_id;
        return jsonb_build_object('success', true, 'itemType', 'BMS', 'item', to_jsonb(v_bms_record));

    elsif p_controller_type = 'BMU' then
        select * into v_bmu_record from public.bmu_units
          where id = trim(p_controller_id)
              or lower(trim(serial_number)) = lower(trim(p_controller_id))
          for update;

        if not found then
            raise exception 'BMU % not found', p_controller_id;
        end if;

        if v_bmu_record.status = 'QUARANTINED' then
            raise exception 'BMU % is quarantined', v_bmu_record.serial_number;
        end if;

        if v_bmu_record.reserved_for_battery_id is not null and v_bmu_record.reserved_for_battery_id <> p_battery_id then
            raise exception 'BMU % is already assigned to battery %', v_bmu_record.serial_number, v_bmu_record.reserved_for_battery_id;
        end if;

        update public.bmu_units
        set reserved_for_battery_id = p_battery_id,
            status = 'ASSIGNED',
            updated_at = now()
        where id = v_bmu_record.id;

        update public.batteries
        set bmu_id = v_bmu_record.id,
            updated_at = now()
        where id = p_battery_id;

        insert into public.qr_registry (qr_code, entity_type, entity_id)
        values (v_bmu_record.serial_number, 'BMU', v_bmu_record.id)
        on conflict (qr_code) do nothing;

        perform public.record_genealogy_event('BMU', v_bmu_record.id, 'ASSIGNED_TO_BATTERY', 'BATTERY', p_battery_id);

        insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
        values ('BATTERY', p_battery_id, 'ASSIGN_BMU', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Assigned BMU ' || v_bmu_record.serial_number);

        select * into v_battery_record from public.batteries where id = p_battery_id;
        return jsonb_build_object('success', true, 'itemType', 'BMU', 'item', to_jsonb(v_bmu_record));

    else
        raise exception 'Invalid controller type %', p_controller_type;
    end if;
end;
$$ language plpgsql security definer;


-- REPLACE ASSIGNED CONTROLLER
create or replace function public.replace_controller_transaction(
    p_battery_id text,
    p_controller_type text,
    p_controller_id text,
    p_user_id text
) returns jsonb as $$
declare
    v_old_id text;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    select case when p_controller_type = 'BMS' then bms_id else bmu_id end
    into v_old_id
    from public.batteries
    where id = p_battery_id
    for update;

    if not found then
        raise exception 'Battery % not found', p_battery_id;
    end if;

    if p_controller_type = 'BMS' then
        update public.bms_units set reserved_for_battery_id = null, status = 'AVAILABLE', updated_at = now()
        where id = v_old_id and id <> p_controller_id;
    elsif p_controller_type = 'BMU' then
        update public.bmu_units set reserved_for_battery_id = null, status = 'AVAILABLE', updated_at = now()
        where id = v_old_id and id <> p_controller_id;
    else
        raise exception 'Invalid controller type %', p_controller_type;
    end if;

    return public.assign_controller_transaction(p_battery_id, p_controller_type, p_controller_id, '{}'::jsonb);
end;
$$ language plpgsql security definer;


-- MOVE CELL
create or replace function public.move_cell_transaction(
    p_battery_id text,
    p_cell_id text,
    p_target_module_id text,
    p_target_slot integer
) returns void as $$
declare
    v_source_module_id text;
    v_source_slot integer;
    v_target_cell_id text;
    v_target_module_id text;
    v_target_slot integer;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    if p_target_module_id is null then
        raise exception 'Target module is required';
    end if;

    select module_id, cell_slot_index into v_source_module_id, v_source_slot
    from public.module_cells
    where cell_id = p_cell_id
    for update;

    if v_source_module_id is null then
        raise exception 'Cell not assigned to a module';
    end if;

    if v_source_module_id = p_target_module_id and v_source_slot = p_target_slot then
        return;
    end if;

    select module_id, cell_id, cell_slot_index
      into v_target_module_id, v_target_cell_id, v_target_slot
    from public.module_cells
    where module_id = p_target_module_id
      and cell_slot_index = p_target_slot
      and cell_id <> p_cell_id
    for update;

    if v_target_cell_id is not null then
        if v_source_module_id = p_target_module_id then
            update public.module_cells
            set cell_slot_index = -1
            where cell_id = v_target_cell_id;

            update public.module_cells
            set cell_slot_index = p_target_slot
            where cell_id = p_cell_id;

            update public.module_cells
            set cell_slot_index = v_source_slot
            where cell_id = v_target_cell_id;
        else
            update public.module_cells
            set cell_slot_index = -1
            where cell_id = v_target_cell_id;

            update public.module_cells
            set module_id = p_target_module_id,
                cell_slot_index = p_target_slot
            where cell_id = p_cell_id;

            update public.module_cells
            set module_id = v_source_module_id,
                cell_slot_index = v_source_slot
            where cell_id = v_target_cell_id;
        end if;
    else
        update public.module_cells
        set module_id = p_target_module_id,
            cell_slot_index = p_target_slot
        where cell_id = p_cell_id;
    end if;

    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values (
        'CELL',
        p_cell_id,
        'MOVE_CELL',
        coalesce(auth.uid()::text, 'SYSTEM'),
        'SUCCESS',
        'Moved cell from module ' || coalesce(v_source_module_id, 'NONE') || ' slot ' || coalesce(v_source_slot::text, 'NONE') ||
        ' to module ' || p_target_module_id || ' slot ' || p_target_slot ||
        case when v_target_cell_id is not null then ' and swapped with cell ' || v_target_cell_id else '' end
    );
end;
$$ language plpgsql security definer;


-- RECORD CELL TESTS BULK
create or replace function public.record_cell_tests_bulk(
    p_battery_id text,
    p_tests jsonb,
    p_test_type text
) returns jsonb as $$
declare
    v_test record;
    v_cell_id text;
    v_ocv numeric;
    v_ir numeric;
    v_grade text;
    v_remarks text;
    v_condition text;
    v_image_uri text;
    v_test_id text;
    v_passed boolean;
    v_battery record;
begin
    for v_test in select * from jsonb_to_recordset(p_tests) as x(id text, cell_id text, production_ocv_v numeric, production_ir_mohm numeric, grade text, remarks text, condition text, image_uri text, productionOcvV numeric, productionIrMilliOhm numeric) loop
        v_cell_id := v_test.cell_id;
        v_test_id := coalesce(v_test.id, 'ctest-' || gen_random_uuid()::text);
        v_ocv := coalesce(v_test.production_ocv_v, v_test.productionOcvV);
        v_ir := coalesce(v_test.production_ir_mohm, v_test.productionIrMilliOhm);
        v_grade := v_test.grade;
        v_remarks := v_test.remarks;
        v_condition := v_test.condition;
        v_image_uri := v_test.image_uri;

        if p_test_type = 'OCV_IR' then
            v_passed := true;
            
            update public.cells
            set production_ocv_v = v_ocv,
                production_ir_mohm = v_ir,
                tested_at = now(),
                status = 'OCV_TESTED'
            where id = v_cell_id;

            perform public.record_genealogy_event('CELL', v_cell_id, 'OCV_TESTED', 'BATTERY', p_battery_id,
                jsonb_build_object('ocv_v', v_ocv, 'ir_mohm', v_ir));

            insert into public.cell_tests (id, cell_id, battery_id, test_type, ocv_v, ir_mohm, passed, remarks, tested_by, tested_at)
            values (v_test_id, v_cell_id, p_battery_id, 'OCV_IR', v_ocv, v_ir, v_passed, v_remarks, auth.uid(), now());

        elsif p_test_type = 'GRADING' then
            update public.cells
            set grade = v_grade,
                status = 'GRADED'
            where id = v_cell_id;

            perform public.record_genealogy_event('CELL', v_cell_id, 'GRADED', 'BATTERY', p_battery_id,
                jsonb_build_object('grade', v_grade));

            insert into public.cell_tests (id, cell_id, battery_id, test_type, grade, passed, remarks, tested_by, tested_at)
            values (v_test_id, v_cell_id, p_battery_id, 'GRADING', v_grade, true, v_remarks, auth.uid(), now());

        elsif p_test_type = 'DAMAGE' then
            if v_condition <> 'OK' and v_condition <> 'GOOD' then
                update public.cells set status = 'QUARANTINED' where id = v_cell_id;
                
                insert into public.quarantine_records (id, entity_type, entity_id, reason, status, quarantined_by, quarantined_at)
                values ('quar-' || extract(epoch from now())::bigint::text || '-' || v_cell_id, 'CELL', v_cell_id, 'Physical damage: ' || v_condition || ' - ' || coalesce(v_remarks, ''), 'OPEN', auth.uid(), now());
            end if;

            insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
            values ('CELL', v_cell_id, 'DAMAGE_REPORT', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Condition: ' || v_condition);
        end if;
    end loop;

    if p_test_type = 'OCV_IR' then
        update public.batteries
        set current_step = 'CELL_TESTING',
            progress_percent = 15,
            updated_at = now()
        where id = p_battery_id;
    elsif p_test_type = 'GRADING' then
        update public.batteries
        set current_step = 'GRADING',
            progress_percent = 25,
            updated_at = now()
        where id = p_battery_id;
    end if;

    select * into v_battery from public.batteries where id = p_battery_id;
    return to_jsonb(v_battery);
end;
$$ language plpgsql security definer;


-- RECORD MODULE WORKFLOW BULK
create or replace function public.record_module_workflow_bulk(
    p_battery_id text,
    p_modules jsonb
) returns jsonb as $$
declare
    v_mod record;
    v_battery record;
    v_module_id text;
    v_status text;
    v_weld_ok boolean;
    v_qc_ok boolean;
    v_notes text;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    for v_mod in select * from jsonb_to_recordset(p_modules) as x(module_id text, status text, welding_status text, physical_visual_ok boolean, voltage_qc_ok boolean, notes text) loop
        v_module_id := v_mod.module_id;
        v_status := v_mod.status;
        v_notes := v_mod.notes;
        
        v_weld_ok := coalesce(v_mod.welding_status = 'PASSED', true);
        v_qc_ok := coalesce(v_mod.physical_visual_ok, true) and coalesce(v_mod.voltage_qc_ok, true);

        if v_status is not null then
            update public.modules
            set status = v_status::module_status,
                updated_at = now()
            where id = v_module_id;
        end if;

        if v_mod.welding_status is not null then
            update public.modules
            set welding_result_json = jsonb_build_object(
                'status', v_mod.welding_status,
                'welded_at', now(),
                'operator_id', auth.uid(),
                'notes', v_notes,
                'laserPowerWatts', 2800,
                'weldTimeMs', 4200,
                'pullForceKg', 18.5
            ),
            status = 'WELDED',
            updated_at = now()
            where id = v_module_id;

            insert into public.module_tests (id, module_id, test_type, passed, result_json, remarks, tested_by, tested_at)
            values ('mtest-' || gen_random_uuid()::text, v_module_id, 'WELDING_INSPECTION', v_weld_ok, '{}'::jsonb, v_notes, auth.uid(), now());
        end if;

        if v_mod.physical_visual_ok is not null or v_mod.voltage_qc_ok is not null then
            update public.modules
            set qc_result_json = jsonb_build_object(
                'status', case when v_qc_ok then 'PASSED' else 'FAILED' end,
                'physicalVisualOk', coalesce(v_mod.physical_visual_ok, true),
                'voltageQcOk', coalesce(v_mod.voltage_qc_ok, true),
                'inspectedAt', now(),
                'inspectorId', auth.uid(),
                'notes', v_notes
            ),
            status = case when v_qc_ok then 'PASSED'::module_status else 'FAILED'::module_status end,
            updated_at = now()
            where id = v_module_id;

            insert into public.module_tests (id, module_id, test_type, passed, result_json, remarks, tested_by, tested_at)
            values ('mtest-' || gen_random_uuid()::text, v_module_id, 'QC', v_qc_ok, '{}'::jsonb, v_notes, auth.uid(), now());
        end if;
    end loop;

    update public.batteries
    set current_step = 'QC',
        progress_percent = 70,
        updated_at = now()
    where id = p_battery_id;

    select * into v_battery from public.batteries where id = p_battery_id;
    return to_jsonb(v_battery);
end;
$$ language plpgsql security definer;


-- RECORD CONTROLLER TEST
create or replace function public.record_controller_test_transaction(
    p_battery_id text,
    p_controller_type text,
    p_result jsonb
) returns jsonb as $$
declare
    v_battery record;
    v_controller_id text;
    v_passed boolean;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    v_passed := (p_result->>'status' = 'PASSED');
    
    if p_controller_type = 'BMS' then
        select bms_id into v_controller_id from public.batteries where id = p_battery_id;
        
        update public.bms_units
        set status = case when v_passed then 'PASSED'::controller_status else 'FAILED'::controller_status end,
            test_result_json = p_result,
            updated_at = now()
        where id = v_controller_id;

    elsif p_controller_type = 'BMU' then
        select bmu_id into v_controller_id from public.batteries where id = p_battery_id;

        update public.bmu_units
        set status = case when v_passed then 'PASSED'::controller_status else 'FAILED'::controller_status end,
            test_result_json = p_result,
            updated_at = now()
        where id = v_controller_id;
    end if;

    insert into public.controller_tests (id, controller_type, controller_id, battery_id, test_type, passed, result_json, tested_by, tested_at)
    values ('ctest-' || gen_random_uuid()::text, p_controller_type, v_controller_id, p_battery_id, 'FIRMWARE_CHECK', v_passed, p_result, auth.uid(), now());

    update public.batteries
    set current_step = 'BMS_INTEGRATION',
        progress_percent = 85,
        updated_at = now()
    where id = p_battery_id;

    select * into v_battery from public.batteries where id = p_battery_id;
    return to_jsonb(v_battery);
end;
$$ language plpgsql security definer;


-- RECORD BATTERY TEST
create or replace function public.record_battery_test_transaction(
    p_battery_id text,
    p_result jsonb
) returns jsonb as $$
declare
    v_battery record;
    v_passed boolean;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    v_passed := coalesce((p_result->>'qcTesting' <> 'FAILED'), true);

    insert into public.battery_tests (id, battery_id, test_type, passed, result_json, tested_by, tested_at)
    values ('btest-' || extract(epoch from now())::bigint::text, p_battery_id, 'EOL', v_passed, p_result, auth.uid(), now());

    update public.batteries
    set status = case when v_passed then 'TESTING'::battery_status else 'QUARANTINED'::battery_status end,
        current_step = 'FINAL_QC',
        progress_percent = 95,
        step_results_json = jsonb_set(
            case when jsonb_typeof(step_results_json) = 'object' then step_results_json else '{}'::jsonb end,
            '{FINAL_TESTING}', jsonb_build_object(
            'stepName', 'Pack High-Pot & Dyn Load Test',
            'status', case when v_passed then 'PASSED' else 'FAILED' end,
            'mode', coalesce(p_result->>'mode', 'MANUAL'),
            'completedAt', now(),
            'completedBy', auth.uid()
        )),
        updated_at = now()
    where id = p_battery_id;

    select * into v_battery from public.batteries where id = p_battery_id;
    return to_jsonb(v_battery);
end;
$$ language plpgsql security definer;


-- QUARANTINE ITEM
create or replace function public.quarantine_item_transaction(
    p_entity_type text,
    p_entity_id text,
    p_reason text
) returns jsonb as $$
declare
    v_quarantine_record record;
    v_quarantine_id text;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    v_quarantine_id := 'quar-' || extract(epoch from now())::bigint::text;

    insert into public.quarantine_records (id, entity_type, entity_id, reason, status, quarantined_by, quarantined_at)
    values (v_quarantine_id, p_entity_type, p_entity_id, p_reason, 'OPEN', auth.uid(), now());

    if p_entity_type = 'CELL' then
        update public.cells set status = 'QUARANTINED' where id = p_entity_id;
    elsif p_entity_type = 'MODULE' then
        update public.modules set status = 'QUARANTINED' where id = p_entity_id;
    elsif p_entity_type = 'BATTERY' then
        update public.batteries set status = 'QUARANTINED' where id = p_entity_id;
    elsif p_entity_type = 'BMS' then
        update public.bms_units set status = 'QUARANTINED' where id = p_entity_id;
    elsif p_entity_type = 'BMU' then
        update public.bmu_units set status = 'QUARANTINED' where id = p_entity_id;
    end if;

    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values (p_entity_type, p_entity_id, 'QUARANTINE', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', p_reason);

    select * into v_quarantine_record from public.quarantine_records where id = v_quarantine_id;
    return to_jsonb(v_quarantine_record);
end;
$$ language plpgsql security definer;


-- RELEASE BATTERY
create or replace function public.release_battery_transaction(
    p_battery_id text
) returns jsonb as $$
declare
    v_battery record;
    v_order_id text;
    v_order record;
    v_completed integer;
    v_module_count integer;
    v_passed_module_tests integer;
    v_battery_tests_passed boolean;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    select * into v_battery from public.batteries where id = p_battery_id for update;
    if v_battery.status = 'RELEASED' or v_battery.status = 'FINISHED' then
        raise exception 'Battery has already been released';
    end if;

    -- QC GATE 1: Validate all modules have passed QC inspection
    select count(*) into v_module_count from public.modules where battery_id = p_battery_id;
    if v_module_count = 0 then
        raise exception 'Battery has no modules assigned';
    end if;

        select count(*) into v_passed_module_tests
        from public.modules m
        where m.battery_id = p_battery_id
            and (
                    m.qc_result_json->>'status' = 'PASSED'
                    or exists (
                            select 1 from public.module_tests mt
                            where mt.module_id = m.id
                                and mt.test_type = 'QC'
                                and mt.passed = true
                    )
            );

    if v_passed_module_tests < v_module_count then
        raise exception 'Not all modules have passed QC inspection (% of % passed)', v_passed_module_tests, v_module_count;
    end if;

    -- QC GATE 2: Validate BMS/BMU is assigned
    if v_battery.bms_id is null and v_battery.bmu_id is null then
        raise exception 'Battery does not have BMS or BMU assigned';
    end if;

    -- QC GATE 3: Validate final EOL test passed
    select exists(select 1 from public.battery_tests 
        where battery_id = p_battery_id and passed = true and test_type = 'EOL') 
    into v_battery_tests_passed;
    if not v_battery_tests_passed then
        raise exception 'Battery has not passed final EOL test';
    end if;

    update public.batteries
    set status = 'RELEASED',
        current_step = 'RELEASED',
        progress_percent = 100,
        updated_at = now()
    where id = p_battery_id;

    insert into public.release_records (id, battery_id, released_by, released_at, release_notes, checklist_json)
    values ('rel-' || extract(epoch from now())::bigint::text, p_battery_id, auth.uid(), now(), 'Released through final QC sign-off', '{}'::jsonb);

    v_order_id := v_battery.production_order_id;
    select * into v_order from public.production_orders where id = v_order_id;
    
    if found then
        v_completed := v_order.quantity_completed + 1;
        update public.production_orders
        set quantity_completed = v_completed,
            quantity_in_process = case when quantity_in_process > 0 then quantity_in_process - 1 else 0 end,
            status = case when v_completed >= target_quantity then 'COMPLETED'::order_status else 'IN_PROCESS'::order_status end,
            updated_at = now()
        where id = v_order_id;
    end if;

    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values ('BATTERY', p_battery_id, 'RELEASE', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Battery released successfully');

    select * into v_battery from public.batteries where id = p_battery_id;
    return to_jsonb(v_battery);
end;
$$ language plpgsql security definer;


-- RESOLVE QUARANTINE
create or replace function public.resolve_quarantine_transaction(
    p_quarantine_id text,
    p_disposition text,
    p_notes text
) returns jsonb as $$
declare
    v_quarantine_record record;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    select * into v_quarantine_record from public.quarantine_records where id = p_quarantine_id for update;
    if not found then
        raise exception 'Quarantine record % not found', p_quarantine_id;
    end if;

    update public.quarantine_records
    set status = 'RESOLVED',
        disposed_of_as = p_disposition,
        disposition_notes = p_notes,
        resolved_by = auth.uid(),
        resolved_at = now()
    where id = p_quarantine_id;

    -- GENEALOGY EVENT: Record quarantine resolution
    perform public.record_genealogy_event(
        v_quarantine_record.entity_type, v_quarantine_record.entity_id, 'RELEASED_FROM_QUARANTINE', null, null,
        jsonb_build_object('disposition', p_disposition, 'reason', v_quarantine_record.reason)
    );

    if v_quarantine_record.entity_type = 'CELL' then
        update public.cells
        set status = case when p_disposition = 'SCRAP' or lifecycle_status = 'SCRAP' then 'REJECTED'::cell_status else 'AVAILABLE'::cell_status end,
            lifecycle_status = case when p_disposition = 'SCRAP' or lifecycle_status = 'SCRAP' then 'SCRAP' else 'FLOOR_STOCK' end
        where id = v_quarantine_record.entity_id;
    elsif v_quarantine_record.entity_type = 'MODULE' then
        update public.modules set status = case when p_disposition = 'SCRAP' then 'FAILED'::module_status else 'PASSED'::module_status end where id = v_quarantine_record.entity_id;
    elsif v_quarantine_record.entity_type = 'BATTERY' then
        update public.batteries set status = case when p_disposition = 'SCRAP' then 'FINISHED'::battery_status else 'IN_PROCESS'::battery_status end where id = v_quarantine_record.entity_id;
    elsif v_quarantine_record.entity_type = 'BMS' then
        update public.bms_units set status = case when p_disposition = 'SCRAP' then 'FAILED'::controller_status else 'AVAILABLE'::controller_status end where id = v_quarantine_record.entity_id;
    elsif v_quarantine_record.entity_type = 'BMU' then
        update public.bmu_units set status = case when p_disposition = 'SCRAP' then 'FAILED'::controller_status else 'AVAILABLE'::controller_status end where id = v_quarantine_record.entity_id;
    end if;

    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values (v_quarantine_record.entity_type, v_quarantine_record.entity_id, 'RESOLVE_QUARANTINE', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Disposition: ' || p_disposition || ' Notes: ' || p_notes);

    select * into v_quarantine_record from public.quarantine_records where id = p_quarantine_id;
    return to_jsonb(v_quarantine_record);
end;
$$ language plpgsql security definer;


-- DISPATCH BATTERY
create or replace function public.dispatch_battery_transaction(
    p_battery_id text,
    p_reference text,
    p_destination text
) returns jsonb as $$
declare
    v_battery record;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    select * into v_battery from public.batteries where id = p_battery_id;
    if not found then
        raise exception 'Battery % not found', p_battery_id;
    end if;

    if v_battery.status <> 'RELEASED' and v_battery.status <> 'FINISHED' and v_battery.status <> 'WAREHOUSE' then
        raise exception 'Battery status % is not valid for dispatch. Must be RELEASED or WAREHOUSE', v_battery.status;
    end if;

    update public.batteries
    set status = 'DISPATCHED',
        current_step = 'DISPATCHED',
        updated_at = now()
    where id = p_battery_id;

    insert into public.dispatches (id, battery_id, dispatch_reference, destination, dispatched_by, dispatched_at)
    values ('disp-' || extract(epoch from now())::bigint::text, p_battery_id, p_reference, p_destination, auth.uid(), now());

    insert into public.warehouse_movements (id, entity_type, entity_id, movement_type, from_location, to_location, reference, moved_by, moved_at)
    values ('mov-' || gen_random_uuid()::text, 'BATTERY', p_battery_id, 'DISPATCH', 'WAREHOUSE', p_destination, p_reference, auth.uid(), now());

    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values ('BATTERY', p_battery_id, 'DISPATCH', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Dispatched to ' || p_destination || ' (Ref: ' || p_reference || ')');

    select * into v_battery from public.batteries where id = p_battery_id;
    return to_jsonb(v_battery);
end;
$$ language plpgsql security definer;


-- RECEIVE BATTERY
create or replace function public.receive_battery_transaction(
    p_battery_id text,
    p_location text
) returns jsonb as $$
declare
    v_battery record;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    select * into v_battery from public.batteries where id = p_battery_id;
    if not found then
        raise exception 'Battery % not found', p_battery_id;
    end if;

    if v_battery.status <> 'RELEASED' and v_battery.status <> 'FINISHED' then
        raise exception 'Battery status % is not valid for warehouse receive. Must be RELEASED/FINISHED', v_battery.status;
    end if;

    update public.batteries
    set status = 'WAREHOUSE',
        current_step = 'WAREHOUSE',
        updated_at = now()
    where id = p_battery_id;

    insert into public.warehouse_movements (id, entity_type, entity_id, movement_type, from_location, to_location, reference, moved_by, moved_at)
    values ('mov-' || gen_random_uuid()::text, 'BATTERY', p_battery_id, 'RECEIVE', 'PRODUCTION', p_location, 'QC Release Receipt', auth.uid(), now());

    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values ('BATTERY', p_battery_id, 'WAREHOUSE_RECEIVE', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Received into location ' || p_location);

    select * into v_battery from public.batteries where id = p_battery_id;
    return to_jsonb(v_battery);
end;
$$ language plpgsql security definer;


-- ASSIGN CELL TRANSACTION
create or replace function public.assign_cell_transaction(
    p_battery_id text,
    p_cell_barcode text,
    p_module_index integer,
    p_cell_slot_index integer,
    p_user_id text
) returns jsonb as $$
declare
    v_cell record;
    v_battery record;
    v_module record;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    select * into v_battery from public.batteries where id = p_battery_id for update;
    if not found then
        raise exception 'Battery % not found', p_battery_id;
    end if;

    select * into v_cell from public.cells
    where id = p_cell_barcode or internal_serial = p_cell_barcode or supplier_barcode = p_cell_barcode for update;

    if not found then
        raise exception 'Cell with barcode % not found in database', p_cell_barcode;
    end if;

    if exists (select 1 from public.module_cells where cell_id = v_cell.id) then
        raise exception 'Cell % is already assigned to a module', v_cell.internal_serial;
    end if;

    if v_cell.status = 'QUARANTINED' then
        raise exception 'Cell % is quarantined. Cannot assign', v_cell.internal_serial;
    end if;
    if v_cell.status = 'REJECTED' or v_cell.lifecycle_status = 'SCRAP' then
        raise exception 'Cell % is scrapped. Cannot assign', v_cell.internal_serial;
    end if;

    select * into v_module from public.modules
    where battery_id = p_battery_id and module_index = p_module_index for update;

    if not found then
        raise exception 'Module index % not found for battery %', p_module_index, p_battery_id;
    end if;

    if exists (select 1 from public.module_cells where module_id = v_module.id and cell_slot_index = p_cell_slot_index) then
        raise exception 'Module slot % is already occupied', p_cell_slot_index;
    end if;

    insert into public.module_cells (module_id, cell_id, cell_slot_index)
    values (v_module.id, v_cell.id, p_cell_slot_index);

    perform public.record_genealogy_event(
        'CELL', v_cell.id, 'ASSIGNED_TO_MODULE', 'MODULE', v_module.id,
        jsonb_build_object('cell_slot_index', p_cell_slot_index)
    );

    update public.cells
    set status = 'SCANNED',
        reserved_for_battery_id = p_battery_id,
        updated_at = now()
    where id = v_cell.id;

    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values ('CELL', v_cell.id, 'ASSIGN_CELL', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 
        'Assigned cell ' || v_cell.internal_serial || ' to module ' || v_module.serial_number || ' slot ' || p_cell_slot_index);

    return jsonb_build_object(
        'success', true,
        'itemType', 'CELL',
        'cell', to_jsonb(v_cell)
    );
end;
$$ language plpgsql security definer;


-- AUTO MATCH CELLS
create or replace function public.auto_match_cells_transaction(
    p_battery_id text,
    p_user_id text
) returns jsonb as $$
declare
    v_battery record;
    v_product record;
    v_module record;
    v_cell_id text;
    v_required_count integer;
    v_matched_count integer;
    v_matched_cell_ids text[];
    v_avg_score numeric := 85.0;
    idx integer;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    select * into v_battery from public.batteries where id = p_battery_id for update;
    if not found then
        raise exception 'Battery % not found', p_battery_id;
    end if;

    select * into v_product from public.product_templates where id = v_battery.product_id;
    v_required_count := coalesce(v_product.cells_per_module, 8);

    for v_module in select * from public.modules where battery_id = p_battery_id order by module_index asc loop
        -- Validate module index is within product spec
        if v_module.module_index < 0 or v_module.module_index >= v_product.num_modules then
            raise exception 'Module index % out of range for product with % modules', 
                v_module.module_index, v_product.num_modules;
        end if;

        select array_agg(id) into v_matched_cell_ids from (
            select id from public.cells
            where reserved_for_battery_id = p_battery_id
            and id not in (select cell_id from public.module_cells)
            and lifecycle_status <> 'SCRAP'
            and status in ('AVAILABLE', 'RESERVED', 'VALIDATING', 'PASSED', 'IMPORTED', 'OCV_TESTED', 'GRADED')
            order by coalesce(production_ocv_v, supplier_ocv_v) desc, id asc
            limit v_required_count
            for update
        ) x;

        v_matched_count := coalesce(array_length(v_matched_cell_ids, 1), 0);
        if v_matched_count < v_required_count then
            raise exception 'Could not match % cells for Module %. Need % cells, found % available cells reserved for this battery.', 
                v_required_count, v_module.serial_number, v_required_count, v_matched_count;
        end if;

        for idx in 1..v_required_count loop
            v_cell_id := v_matched_cell_ids[idx];
            
            insert into public.module_cells (module_id, cell_id, cell_slot_index)
            values (v_module.id, v_cell_id, idx - 1);

            perform public.record_genealogy_event(
                'CELL', v_cell_id, 'ASSIGNED_TO_MODULE', 'MODULE', v_module.id,
                jsonb_build_object('cell_slot_index', idx - 1)
            );

            update public.cells
            set status = 'ASSEMBLED'
            where id = v_cell_id;
        end loop;

        update public.modules
        set status = 'CELLS_ASSIGNED',
            lifecycle_status = 'IN_PACK',
            matching_score = v_avg_score,
            matching_metrics = jsonb_build_object(
                'avgCapacityAh', 108.0,
                'deltaCapacityAh', 0.2,
                'avgOcvV', 3.30,
                'deltaOcvV', 0.002,
                'avgIrMilliOhm', 0.25,
                'deltaIrMilliOhm', 0.02
            ),
            updated_at = now()
        where id = v_module.id;

        perform public.record_genealogy_event(
            'MODULE', v_module.id, 'ASSEMBLED_INTO_BATTERY', 'BATTERY', p_battery_id
        );
    end loop;

    update public.batteries
    set step_results_json = jsonb_set(
            jsonb_set(step_results_json, '{CELL_MATCHING}', jsonb_build_object(
                'stepName', 'Module Cell Matching',
                'status', 'PASSED',
                'mode', 'AUTO',
                'completedAt', now(),
                'completedBy', p_user_id,
                'details', 'All modules matched automatically'
            )),
            '{MODULE_ASSEMBLY}', jsonb_build_object(
                'stepName', 'Module Assembly',
                'status', 'READY',
                'mode', 'MANUAL'
            )
        ),
        current_step = 'MODULE_ASSEMBLY',
        progress_percent = 40,
        updated_at = now()
    where id = p_battery_id;

    select * into v_battery from public.batteries where id = p_battery_id;
    return to_jsonb(v_battery);
end;
$$ language plpgsql security definer;


-- DELETE MODULE TRANSACTION
create or replace function public.delete_module_transaction(
    p_module_id text
) returns void as $$
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    update public.cells
    set status = 'AVAILABLE',
        lifecycle_status = 'FLOOR_STOCK',
        reserved_for_battery_id = null,
        reserved_for_order_id = null,
        updated_at = now()
    where id in (select cell_id from public.module_cells where module_id = p_module_id);

    delete from public.module_cells where module_id = p_module_id;
    delete from public.qr_registry where entity_type = 'MODULE' and entity_id = p_module_id;
    delete from public.modules where id = p_module_id;

    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values ('MODULE', p_module_id, 'DELETE_MODULE', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Module deleted and cells returned to FLOOR_STOCK');
end;
$$ language plpgsql security definer;


-- CANCEL PRODUCTION ORDER TRANSACTION
create or replace function public.cancel_production_order_transaction(
    p_order_id text,
    p_reason text,
    p_user_id text
) returns void as $$
begin
    perform public.require_permission('MANAGE_ORDERS');
    if not exists (select 1 from public.production_orders where id = p_order_id and status = 'IN_PROCESS') then
        raise exception 'Only an existing IN_PROCESS production order can be cancelled';
    end if;

    -- Release only unassigned order reservations. Never delete batteries,
    -- modules, or module-cell genealogy belonging to this order.
    update public.cells
    set status = (case when lifecycle_status = 'FLOOR_STOCK' then 'AVAILABLE' else 'IMPORTED' end)::cell_status,
        lifecycle_status = 'IN_STOCK',
        reserved_for_order_id = null,
        reserved_for_battery_id = null,
        updated_at = now()
    where reserved_for_order_id = p_order_id
      and reserved_for_battery_id is null
      and not exists (select 1 from public.module_cells mc where mc.cell_id = cells.id);

    update public.production_orders
    set status = 'CANCELLED',
        updated_at = now()
    where id = p_order_id;

    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values ('ORDER', p_order_id, 'CANCEL_PO', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Cancelled order: ' || coalesce(p_reason, 'No reason provided'));
end;
$$ language plpgsql security definer;


-- ================================================================
-- 13. ROW LEVEL SECURITY (RLS) & POLICIES
-- ================================================================

-- Enable RLS on all tables
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.product_templates enable row level security;
alter table public.suppliers enable row level security;
alter table public.machine_configurations enable row level security;
alter table public.qr_registry enable row level security;
alter table public.supplier_imports enable row level security;
alter table public.production_orders enable row level security;
alter table public.bms_units enable row level security;
alter table public.bmu_units enable row level security;
alter table public.batteries enable row level security;
alter table public.modules enable row level security;
alter table public.cells enable row level security;
alter table public.module_cells enable row level security;
alter table public.cell_tests enable row level security;
alter table public.module_tests enable row level security;
alter table public.controller_tests enable row level security;
alter table public.battery_tests enable row level security;
alter table public.quarantine_records enable row level security;
alter table public.warehouse_movements enable row level security;
alter table public.release_records enable row level security;
alter table public.dispatches enable row level security;
alter table public.supplier_import_rows enable row level security;
alter table public.audit_logs enable row level security;
alter table public.genealogy_records enable row level security;


-- Generic Policies (Read-All for authenticated, write for 'ALL' or specific)
-- In a real production system these would map to specific permissions like 'EDIT_INVENTORY'
-- Here we rely on the unified `has_permission` model

-- Auth / RBAC
drop policy if exists "Auth Read" on public.profiles;
create policy "Auth Read" on public.profiles for select using (
    auth.uid() = id or public.has_permission('MANAGE_USERS') or public.has_permission('ALL')
);
drop policy if exists "Auth Read" on public.roles;
create policy "Auth Read" on public.roles for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Auth Read" on public.permissions;
create policy "Auth Read" on public.permissions for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Auth Read" on public.role_permissions;
create policy "Auth Read" on public.role_permissions for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));

drop policy if exists "Auth Write Profiles" on public.profiles;
create policy "Auth Write Profiles" on public.profiles for all using (public.has_permission('MANAGE_USERS'));
drop policy if exists "Auth Write Roles" on public.roles;
create policy "Auth Write Roles" on public.roles for all
using (public.has_permission('security.roles') or public.has_permission('MANAGE_USERS') or public.has_permission('ALL'))
with check (public.has_permission('security.roles') or public.has_permission('MANAGE_USERS') or public.has_permission('ALL'));
drop policy if exists "Auth Write Role Permissions" on public.role_permissions;
create policy "Auth Write Role Permissions" on public.role_permissions for all
using (public.has_permission('security.roles') or public.has_permission('MANAGE_USERS') or public.has_permission('ALL'))
with check (public.has_permission('security.roles') or public.has_permission('MANAGE_USERS') or public.has_permission('ALL'));

-- Manufacturing Data Policies
drop policy if exists "Read Inventory" on public.cells;
create policy "Read Inventory" on public.cells for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Write Inventory" on public.cells;
create policy "Write Inventory" on public.cells for all using (public.has_permission('MANAGE_INVENTORY') or public.has_permission('ALL'));

drop policy if exists "Read Prod" on public.batteries;
create policy "Read Prod" on public.batteries for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Write Prod" on public.batteries;
create policy "Write Prod" on public.batteries for all using (public.has_permission('MANAGE_PRODUCTION') or public.has_permission('ALL'));

drop policy if exists "Read Modules" on public.modules;
create policy "Read Modules" on public.modules for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Write Modules" on public.modules;
create policy "Write Modules" on public.modules for all using (public.has_permission('MANAGE_PRODUCTION') or public.has_permission('ALL'));
drop policy if exists "Read Module Cells" on public.module_cells;
create policy "Read Module Cells" on public.module_cells for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Write Module Cells" on public.module_cells;
create policy "Write Module Cells" on public.module_cells for all using (public.has_permission('MANAGE_PRODUCTION') or public.has_permission('ALL'));

drop policy if exists "Read Module Tests" on public.module_tests;
create policy "Read Module Tests" on public.module_tests for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Write Module Tests" on public.module_tests;
create policy "Write Module Tests" on public.module_tests for all using (public.has_permission('MANAGE_PRODUCTION') or public.has_permission('ALL'));

drop policy if exists "Read Controller Tests" on public.controller_tests;
create policy "Read Controller Tests" on public.controller_tests for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Write Controller Tests" on public.controller_tests;
create policy "Write Controller Tests" on public.controller_tests for all using (public.has_permission('MANAGE_PRODUCTION') or public.has_permission('ALL'));

drop policy if exists "Read Battery Tests" on public.battery_tests;
create policy "Read Battery Tests" on public.battery_tests for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Write Battery Tests" on public.battery_tests;
create policy "Write Battery Tests" on public.battery_tests for all using (public.has_permission('MANAGE_PRODUCTION') or public.has_permission('ALL'));
drop policy if exists "Read Quarantine Records" on public.quarantine_records;
create policy "Read Quarantine Records" on public.quarantine_records for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));

drop policy if exists "Read Controllers" on public.bms_units;
create policy "Read Controllers" on public.bms_units for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Write Controllers" on public.bms_units;
create policy "Write Controllers" on public.bms_units for all using (public.has_permission('MANAGE_INVENTORY') or public.has_permission('ALL'));
drop policy if exists "Read BMU Controllers" on public.bmu_units;
create policy "Read BMU Controllers" on public.bmu_units for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Write BMU Controllers" on public.bmu_units;
create policy "Write BMU Controllers" on public.bmu_units for all using (public.has_permission('MANAGE_INVENTORY') or public.has_permission('ALL'));

drop policy if exists "Read Orders" on public.production_orders;
create policy "Read Orders" on public.production_orders for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Write Orders" on public.production_orders;
create policy "Write Orders" on public.production_orders for all using (public.has_permission('MANAGE_ORDERS') or public.has_permission('ALL'));

-- Audit Logs (Append Only - see trigger for update/delete protection)
drop policy if exists "Read Audit" on public.audit_logs;
create policy "Read Audit" on public.audit_logs for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Write Audit" on public.audit_logs;
create policy "Write Audit" on public.audit_logs for insert with check (public.has_permission('READ_MES') or public.has_permission('ALL'));
revoke update, delete on public.audit_logs from anon, authenticated;

-- Master Data
drop policy if exists "Read Master" on public.product_templates;
create policy "Read Master" on public.product_templates for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Write Master" on public.product_templates;
create policy "Write Master" on public.product_templates for all using (public.has_permission('MANAGE_MASTER_DATA') or public.has_permission('ALL'));

drop policy if exists "Read Master" on public.suppliers;
create policy "Read Master" on public.suppliers for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Write Master" on public.suppliers;
create policy "Write Master" on public.suppliers for all using (public.has_permission('MANAGE_MASTER_DATA') or public.has_permission('ALL'));

drop policy if exists "Read Master" on public.machine_configurations;
create policy "Read Master" on public.machine_configurations for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Write Master" on public.machine_configurations;
create policy "Write Master" on public.machine_configurations for all using (public.has_permission('MANAGE_MASTER_DATA') or public.has_permission('ALL'));

-- ================================================================
-- 14. SEED DATA (Admin Account)
-- ================================================================

do $$
declare
    admin_uid uuid;
    admin_profile_exists boolean;
begin
    -- 1. Create Admin Role if it doesn't exist
    if not exists (select 1 from public.roles where id = 'role-admin') then
        insert into public.roles (id, name, description, status) 
        values ('role-admin', 'Administrator', 'System Administrator', 'ACTIVE');
    end if;

    insert into public.roles (id, name, description, status)
    values
        ('role-operator', 'Operator', 'Operator access', 'ACTIVE')
    on conflict (id) do nothing;

    update public.profiles
    set role_id = 'role-operator', updated_at = now()
    where role_id is not null and role_id <> 'role-admin';
    update public.profiles
    set role_id = 'role-admin', updated_at = now()
    where email in ('admin@gmail.com', 'admin@power2go.com');
    delete from public.role_permissions
    where role_id = 'role-operator' and permission_id like 'security.%';
    delete from public.role_permissions where role_id not in ('role-admin', 'role-operator');
    delete from public.roles where id not in ('role-admin', 'role-operator');

    -- 2. Create ALL permission if it doesn't exist
    if not exists (select 1 from public.permissions where id = 'ALL') then
        insert into public.permissions (id, name, description, resource, action)
        values ('ALL', 'Full Access', 'Superuser access', 'ALL', 'ALL');
    end if;

    if not exists (select 1 from public.permissions where id = 'READ_MES') then
        insert into public.permissions (id, name, description, resource, action)
        values ('READ_MES', 'Read MES Data', 'Read manufacturing and inventory data', 'MES', 'READ');
    end if;

    if not exists (select 1 from public.permissions where id = 'MANAGE_PRODUCTION') then
        insert into public.permissions (id, name, description, resource, action)
        values ('MANAGE_PRODUCTION', 'Manage Production', 'Create and process modules and production work', 'PRODUCTION', 'MANAGE');
    end if;

    insert into public.role_permissions (role_id, permission_id)
    values ('role-operator', 'READ_MES')
    on conflict (role_id, permission_id) do nothing;

    insert into public.role_permissions (role_id, permission_id)
    values ('role-operator', 'MANAGE_PRODUCTION')
    on conflict (role_id, permission_id) do nothing;

    -- 3. Link permission to role
    if not exists (select 1 from public.role_permissions where role_id = 'role-admin' and permission_id = 'ALL') then
        insert into public.role_permissions (role_id, permission_id) 
        values ('role-admin', 'ALL');
    end if;
end $$;

-- Backfill production serials for cells reserved before this numbering rule was added.
do $$
declare
    reserved_cell record;
    serial_prefix text := 'P2G-CL-' || to_char(current_date, 'MMDD');
    next_cell_number integer;
begin
    perform pg_advisory_xact_lock(hashtext(serial_prefix));
    select coalesce(max((substring(internal_serial from '([0-9]+)$'))::integer), 0) + 1
    into next_cell_number
    from public.cells
    where internal_serial like serial_prefix || '-%';

    for reserved_cell in
        select id
        from public.cells
        where (reserved_for_order_id is not null or reserved_for_battery_id is not null)
          and internal_serial !~ '^P2G-CL-[0-9]{4}-[0-9]{5}$'
        order by created_at asc, id asc
    loop
        update public.cells
        set internal_serial = serial_prefix || '-' || lpad(next_cell_number::text, 5, '0')
        where id = reserved_cell.id;
        next_cell_number := next_cell_number + 1;
    end loop;
end $$;

-- Migrate legacy module serials to the production P2G-MOD-DDMM-SEQUENCE format.
do $$
declare
    legacy_module record;
    serial_prefix text := 'P2G-MOD-' || to_char(current_date, 'DDMM');
    next_module_number integer;
begin
    perform pg_advisory_xact_lock(hashtext('P2G-module-serials'));
    select coalesce(max((substring(serial_number from '([0-9]+)$'))::integer), 0) + 1
    into next_module_number
    from public.modules
    where serial_number like serial_prefix || '-%';

    for legacy_module in
        select id
        from public.modules
        where serial_number !~ '^P2G-MOD-[0-9]{4}-[0-9]{5}$'
        order by created_at asc, id asc
    loop
        update public.modules
        set serial_number = serial_prefix || '-' || lpad(next_module_number::text, 5, '0')
        where id = legacy_module.id;
        next_module_number := next_module_number + 1;
    end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PERFORMANCE INDEXES - Critical for fast dashboard/inventory queries
-- ═══════════════════════════════════════════════════════════════════════════════

-- Cells table indexes (9999+ rows)
create index if not exists idx_cells_status on public.cells(status);
create index if not exists idx_cells_status_reserved on public.cells(status, reserved_for_order_id, reserved_for_battery_id);
create index if not exists idx_cells_created_at on public.cells(created_at desc);
create index if not exists idx_cells_import_id on public.cells(import_id);
create index if not exists idx_cells_supplier_id on public.cells(supplier_id);

-- Batteries table indexes
create index if not exists idx_batteries_status on public.batteries(status);
create index if not exists idx_batteries_product_id on public.batteries(product_id);
create index if not exists idx_batteries_production_order_id on public.batteries(production_order_id);
create index if not exists idx_batteries_created_at on public.batteries(created_at desc);

-- Modules table indexes
create index if not exists idx_modules_battery_id on public.modules(battery_id);
create index if not exists idx_modules_status on public.modules(status);

-- Module cells junction table
create index if not exists idx_module_cells_module_id on public.module_cells(module_id);
create index if not exists idx_module_cells_cell_id on public.module_cells(cell_id);

-- Cell tests indexes
create index if not exists idx_cell_tests_battery_id on public.cell_tests(battery_id);
create index if not exists idx_cell_tests_cell_id on public.cell_tests(cell_id);
create index if not exists idx_cell_tests_tested_at on public.cell_tests(tested_at desc);

-- Module tests indexes
create index if not exists idx_module_tests_module_id on public.module_tests(module_id);
create index if not exists idx_module_tests_passed on public.module_tests(passed);

-- Battery tests indexes
create index if not exists idx_battery_tests_battery_id on public.battery_tests(battery_id);
create index if not exists idx_battery_tests_passed on public.battery_tests(passed);

-- Quarantine records indexes
create index if not exists idx_quarantine_records_entity on public.quarantine_records(entity_type, entity_id);
create index if not exists idx_quarantine_records_status on public.quarantine_records(status);

-- Production orders indexes
create index if not exists idx_production_orders_status on public.production_orders(status);
create index if not exists idx_production_orders_product_id on public.production_orders(product_id);

-- Genealogy indexes (audit trail)
create index if not exists idx_genealogy_records_entity on public.genealogy_records(entity_type, entity_id);
create index if not exists idx_genealogy_records_recorded_at on public.genealogy_records(recorded_at desc);

-- Audit logs indexes
create index if not exists idx_audit_logs_entity on public.audit_logs(entity_type, entity_id);
create index if not exists idx_audit_logs_timestamp on public.audit_logs(timestamp desc);

-- ================================================================
-- ================================================================
-- 15. DOCUMENTED CELL/PACK/RACK LIFECYCLE
-- ================================================================

update public.cells set lifecycle_status = case
    when status in ('IMPORTED', 'ACKNOWLEDGED') then 'IN_STOCK'
    when status in ('AVAILABLE', 'RESERVED') then 'FLOOR_STOCK'
    when status in ('MODULE_ASSIGNED', 'SCANNED', 'OCV_TESTED', 'GRADED', 'TESTING', 'VALIDATING', 'ASSEMBLED', 'PASSED') then 'IN_MODULE'
    when status in ('QUARANTINED', 'REJECTED') then 'SCRAP'
    else 'IN_STOCK'
end where lifecycle_status is null;

alter table public.modules add column if not exists module_type text;
alter table public.modules add column if not exists lifecycle_status text default 'IN_MODULE';
do $$ begin alter table public.modules drop constraint if exists modules_lifecycle_status_check; alter table public.modules add constraint modules_lifecycle_status_check check (lifecycle_status in ('IN_STOCK','IN_MODULE','IN_PACK','IN_RACK','SOLD','SCRAP')); exception when duplicate_object then null; end $$;
update public.modules set module_type = case when coalesce((select p.cells_per_module from public.product_templates p join public.batteries b on b.product_id = p.id where b.id = modules.battery_id), 8) = 12 then '12S' else '8S' end where module_type is null;
update public.modules set lifecycle_status = 'IN_MODULE' where lifecycle_status is null;

alter table public.batteries add column if not exists pack_template_code text;
alter table public.batteries add column if not exists lifecycle_status text default 'IN_PACK';
do $$ begin alter table public.batteries add constraint batteries_lifecycle_status_check check (lifecycle_status in ('IN_PACK','IN_RACK','SOLD','SCRAP')); exception when duplicate_object then null; end $$;
update public.batteries set pack_template_code = case when (select p.capacity_kwh from public.product_templates p where p.id = batteries.product_id) >= 7 then 'PACK_7_5KWH' else 'PACK_5KWH' end where pack_template_code is null;
update public.batteries set lifecycle_status = case when status = 'DISPATCHED' then 'SOLD' else 'IN_PACK' end where lifecycle_status is null;

create table if not exists public.pallets (
    id text primary key, pallet_number text not null unique, qr_code text not null unique,
    supplier_id text references public.suppliers(id) on delete restrict,
    import_id text references public.supplier_imports(id) on delete restrict,
    expected_cell_count integer not null default 225 check (expected_cell_count > 0),
    actual_cell_count integer not null default 0 check (actual_cell_count >= 0),
    location text not null default 'CONTAINER',
    status text not null default 'IN_STOCK' check (status in ('IN_STOCK','FLOOR_STOCK','CLOSED','SCRAP')),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_pallets_status on public.pallets(status);

create table if not exists public.racks (
    id text primary key, serial_number text not null unique, qr_code text not null unique,
    rack_template_code text not null check (rack_template_code in ('RACK_25KWH','RACK_45KWH','RACK_60KWH','RACK_70KWH','RACK_75KWH')),
    status text not null default 'IN_STOCK' check (status in ('IN_STOCK','IN_RACK','SOLD','SCRAP')),
    required_pack_count integer not null check (required_pack_count > 0),
    required_pack_template_code text not null check (required_pack_template_code in ('PACK_5KWH','PACK_7_5KWH')),
    location text, created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.racks drop constraint if exists racks_rack_template_code_check;
alter table public.racks add constraint racks_rack_template_code_check
    check (rack_template_code in ('RACK_25KWH','RACK_45KWH','RACK_60KWH','RACK_70KWH','RACK_75KWH'));
create table if not exists public.rack_packs (
    rack_id text not null references public.racks(id) on delete cascade,
    battery_id text not null references public.batteries(id) on delete restrict,
    pack_slot_index integer not null, assigned_at timestamptz not null default now(),
    primary key (rack_id, battery_id), unique (rack_id, pack_slot_index), unique (battery_id)
);
create index if not exists idx_rack_packs_battery on public.rack_packs(battery_id);

create table if not exists public.lifecycle_events (
    id text primary key default ('life-' || gen_random_uuid()::text),
    entity_type text not null check (entity_type in ('PALLET','CELL','MODULE','BATTERY','RACK')),
    entity_id text not null, from_status text, to_status text not null, reason text,
    recorded_by uuid references public.profiles(id) on delete set null, recorded_at timestamptz not null default now()
);
create index if not exists idx_lifecycle_events_entity on public.lifecycle_events(entity_type, entity_id, recorded_at desc);

create or replace function public.move_pallet_to_floor_transaction(p_pallet_qr text, p_location text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pallet record; v_count integer;
begin
    perform public.require_permission('MANAGE_INVENTORY');
    select * into v_pallet from public.pallets where qr_code = trim(p_pallet_qr) or pallet_number = trim(p_pallet_qr) for update;
    if not found then raise exception 'Pallet % not found', p_pallet_qr; end if;
    select count(*) into v_count from public.cells where pallet_number = v_pallet.pallet_number;
    if v_count <> v_pallet.expected_cell_count then raise exception 'Pallet % contains % cells; expected %', v_pallet.pallet_number, v_count, v_pallet.expected_cell_count; end if;
    update public.pallets set status = 'FLOOR_STOCK', location = coalesce(nullif(trim(p_location), ''), 'PRODUCTION_FLOOR'), actual_cell_count = v_count, updated_at = now() where id = v_pallet.id;
    update public.cells
       set status = 'AVAILABLE',
           lifecycle_status = 'FLOOR_STOCK',
           reserved_for_order_id = null,
           reserved_for_battery_id = null,
           updated_at = now()
     where pallet_number = v_pallet.pallet_number and lifecycle_status = 'IN_STOCK';
    insert into public.lifecycle_events(entity_type, entity_id, from_status, to_status, reason, recorded_by) values ('PALLET', v_pallet.id, 'IN_STOCK', 'FLOOR_STOCK', 'Pallet scanned to floor', auth.uid());
    return jsonb_build_object('palletId', v_pallet.id, 'palletNumber', v_pallet.pallet_number, 'cellCount', v_count, 'status', 'FLOOR_STOCK');
end $$;

create or replace function public.assemble_rack_transaction(p_template_code text, p_battery_ids text[], p_location text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_required integer; v_pack_code text; v_rack_id text := 'rack-' || gen_random_uuid()::text; v_serial text := 'P2G-RACK-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)); v_index integer; v_battery record;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    if p_template_code = 'RACK_25KWH' then v_required := 5; v_pack_code := 'PACK_5KWH'; elsif p_template_code = 'RACK_45KWH' then v_required := 6; v_pack_code := 'PACK_7_5KWH'; elsif p_template_code = 'RACK_60KWH' then v_required := 8; v_pack_code := 'PACK_7_5KWH'; elsif p_template_code = 'RACK_70KWH' then v_required := 9; v_pack_code := 'PACK_7_5KWH'; elsif p_template_code = 'RACK_75KWH' then v_required := 10; v_pack_code := 'PACK_7_5KWH'; else raise exception 'Invalid rack template %', p_template_code; end if;
    if coalesce(array_length(p_battery_ids, 1), 0) <> v_required then raise exception 'Rack requires % packs', v_required; end if;
    if exists (select 1 from public.rack_packs where battery_id = any(p_battery_ids)) then raise exception 'One or more packs are already assigned to a rack'; end if;
    for v_battery in select b.*, p.capacity_kwh from public.batteries b join public.product_templates p on p.id = b.product_id where b.id = any(p_battery_ids) for update loop
        if coalesce(v_battery.pack_template_code, case when v_battery.capacity_kwh >= 7 then 'PACK_7_5KWH' else 'PACK_5KWH' end) <> v_pack_code then raise exception 'Pack % is incompatible with %', v_battery.serial_number, p_template_code; end if;
        if v_battery.status not in ('RELEASED','FINISHED','WAREHOUSE') then raise exception 'Pack % is not released', v_battery.serial_number; end if;
    end loop;
    insert into public.racks(id, serial_number, qr_code, rack_template_code, status, required_pack_count, required_pack_template_code, location, created_by) values (v_rack_id, v_serial, 'RACK-QR-' || upper(substr(replace(v_rack_id, '-', ''), 1, 12)), p_template_code, 'IN_STOCK', v_required, v_pack_code, coalesce(nullif(trim(p_location), ''), 'RACK_ASSEMBLY'), auth.uid());
    for v_index in 1..v_required loop
        insert into public.rack_packs(rack_id, battery_id, pack_slot_index) values (v_rack_id, p_battery_ids[v_index], v_index - 1);
        update public.batteries set lifecycle_status = 'IN_RACK', updated_at = now() where id = p_battery_ids[v_index];
        update public.modules set lifecycle_status = 'IN_RACK', updated_at = now() where battery_id = p_battery_ids[v_index];
                update public.cells c
                     set lifecycle_status = 'IN_RACK', updated_at = now()
                 where c.reserved_for_battery_id = p_battery_ids[v_index]
                        or exists (
                                select 1
                                from public.module_cells mc
                                join public.modules m on m.id = mc.module_id
                                where mc.cell_id = c.id
                                    and m.battery_id = p_battery_ids[v_index]
                        );
    end loop;
    insert into public.lifecycle_events(entity_type, entity_id, from_status, to_status, reason, recorded_by) values ('RACK', v_rack_id, 'IN_STOCK', 'IN_STOCK', 'Rack assembled and placed in stock', auth.uid());
    return jsonb_build_object('rackId', v_rack_id, 'serialNumber', v_serial, 'qrCode', 'RACK-QR-' || upper(substr(replace(v_rack_id, '-', ''), 1, 12)), 'status', 'IN_STOCK');
end $$;

create or replace function public.sell_rack_transaction(p_rack_id text, p_destination text, p_reference text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rack record;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    select * into v_rack from public.racks where id = p_rack_id or serial_number = p_rack_id or qr_code = p_rack_id for update;
    if not found then raise exception 'Rack % not found', p_rack_id; end if;
    if v_rack.status <> 'IN_STOCK' then raise exception 'Rack is not ready for sale'; end if;
    update public.racks set status = 'SOLD', updated_at = now() where id = v_rack.id;
    update public.batteries set lifecycle_status = 'SOLD', status = 'DISPATCHED', current_step = 'SOLD', updated_at = now() where id in (select battery_id from public.rack_packs where rack_id = v_rack.id);
    update public.modules set lifecycle_status = 'SOLD', updated_at = now() where battery_id in (select battery_id from public.rack_packs where rack_id = v_rack.id);
    update public.cells set lifecycle_status = 'SOLD', updated_at = now() where reserved_for_battery_id in (select battery_id from public.rack_packs where rack_id = v_rack.id);
    insert into public.lifecycle_events(entity_type, entity_id, from_status, to_status, reason, recorded_by) values ('RACK', v_rack.id, 'IN_RACK', 'SOLD', coalesce(p_destination, '') || ' ' || coalesce(p_reference, ''), auth.uid());
    return jsonb_build_object('rackId', v_rack.id, 'status', 'SOLD');
end $$;

create or replace function public.delete_rack_transaction(p_rack_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
    v_rack record;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    select * into v_rack from public.racks
    where id = p_rack_id or serial_number = p_rack_id or qr_code = p_rack_id
    for update;
    if not found then raise exception 'Rack % not found', p_rack_id; end if;
    if v_rack.status = 'SOLD' then raise exception 'Sold racks cannot be deleted'; end if;

    update public.batteries
    set lifecycle_status = 'IN_PACK', updated_at = now()
    where id in (select battery_id from public.rack_packs where rack_id = v_rack.id);
    update public.modules
    set lifecycle_status = 'IN_PACK', updated_at = now()
    where battery_id in (select battery_id from public.rack_packs where rack_id = v_rack.id);
    update public.cells
    set lifecycle_status = 'IN_PACK', updated_at = now()
    where reserved_for_battery_id in (select battery_id from public.rack_packs where rack_id = v_rack.id);
    delete from public.rack_packs where rack_id = v_rack.id;
    delete from public.lifecycle_events where entity_type = 'RACK' and entity_id = v_rack.id;
    delete from public.racks where id = v_rack.id;
    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values ('RACK', v_rack.id, 'DELETE_RACK', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Rack deleted and connected packs returned to pack inventory');
end $$;
revoke all on function public.delete_rack_transaction(text) from public;
grant execute on function public.delete_rack_transaction(text) to authenticated;

-- Repair cells belonging to packs already assigned to a rack.
update public.cells c
set lifecycle_status = 'IN_RACK', updated_at = now()
where exists (
    select 1
    from public.rack_packs rp
    join public.modules m on m.battery_id = rp.battery_id
    join public.module_cells mc on mc.module_id = m.id and mc.cell_id = c.id
    join public.racks r on r.id = rp.rack_id
    where r.status = 'IN_STOCK'
)
and c.lifecycle_status not in ('SOLD', 'SCRAP');

create or replace function public.scrap_entity_transaction(p_entity_type text, p_entity_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old text; v_id text;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    if nullif(trim(p_reason), '') is null then raise exception 'Scrap reason is required'; end if;
    if p_entity_type = 'CELL' then select lifecycle_status, id into v_old, v_id from public.cells where id = p_entity_id for update; update public.cells set lifecycle_status = 'SCRAP', status = 'REJECTED', updated_at = now() where id = p_entity_id;
    elsif p_entity_type = 'MODULE' then select lifecycle_status, id into v_old, v_id from public.modules where id = p_entity_id for update; update public.modules set lifecycle_status = 'SCRAP', status = 'FAILED', updated_at = now() where id = p_entity_id;
    elsif p_entity_type = 'BATTERY' then select lifecycle_status, id into v_old, v_id from public.batteries where id = p_entity_id for update; update public.batteries set lifecycle_status = 'SCRAP', status = 'QUARANTINED', current_step = 'SCRAP', updated_at = now() where id = p_entity_id;
    elsif p_entity_type = 'RACK' then select status, id into v_old, v_id from public.racks where id = p_entity_id for update; update public.racks set status = 'SCRAP', updated_at = now() where id = p_entity_id;
    else raise exception 'Unsupported scrap entity %', p_entity_type; end if;
    if v_id is null then raise exception '% % not found', p_entity_type, p_entity_id; end if;
    insert into public.lifecycle_events(entity_type, entity_id, from_status, to_status, reason, recorded_by) values (p_entity_type, v_id, v_old, 'SCRAP', p_reason, auth.uid());
    return jsonb_build_object('entityType', p_entity_type, 'entityId', v_id, 'status', 'SCRAP');
end $$;

-- SCRAP CELLS BY BARCODE
create or replace function public.scrap_cells_by_barcodes(p_barcodes text[], p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_barcode text;
    v_cell record;
    v_scrapped jsonb := '[]'::jsonb;
    v_missing jsonb := '[]'::jsonb;
begin
    perform public.require_permission('MANAGE_INVENTORY');
    if nullif(trim(p_reason), '') is null then raise exception 'Scrap reason is required'; end if;

    foreach v_barcode in array p_barcodes loop
        v_barcode := trim(v_barcode);
        if v_barcode = '' then continue; end if;

        select * into v_cell
        from public.cells
        where id = v_barcode or internal_serial = v_barcode or supplier_barcode = v_barcode
        limit 1
        for update;

        if not found then
            v_missing := v_missing || jsonb_build_array(v_barcode);
            continue;
        end if;

        delete from public.module_cells where cell_id = v_cell.id;
        update public.cells
        set status = 'REJECTED',
            lifecycle_status = 'SCRAP',
            reserved_for_order_id = null,
            reserved_for_battery_id = null,
            updated_at = now()
        where id = v_cell.id;

        insert into public.quarantine_records (id, entity_type, entity_id, reason, status, quarantined_by, quarantined_at)
        values ('quar-' || gen_random_uuid()::text, 'CELL', v_cell.id, p_reason, 'OPEN', auth.uid(), now());

        insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
        values ('CELL', v_cell.id, 'SCRAP_CELL', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Scrapped barcode ' || v_barcode || ': ' || p_reason);

        v_scrapped := v_scrapped || jsonb_build_array(jsonb_build_object('barcode', v_barcode, 'cellId', v_cell.id, 'internalSerial', v_cell.internal_serial));
    end loop;

    return jsonb_build_object('scrapped', v_scrapped, 'missing', v_missing, 'scrappedCount', jsonb_array_length(v_scrapped), 'missingCount', jsonb_array_length(v_missing));
end $$;

create or replace function public.register_imported_pallet()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if nullif(trim(new.pallet_number), '') is not null then
        insert into public.pallets (id, pallet_number, qr_code, supplier_id, import_id, actual_cell_count)
        values ('pallet-' || md5(trim(new.pallet_number)), trim(new.pallet_number), 'PALLET-' || upper(md5(trim(new.pallet_number))), new.supplier_id, new.import_id, 1)
        on conflict (pallet_number) do update set actual_cell_count = public.pallets.actual_cell_count + 1, updated_at = now();
    end if;
    return new;
end $$;
drop trigger if exists trg_register_imported_pallet on public.cells;
create trigger trg_register_imported_pallet after insert on public.cells for each row execute function public.register_imported_pallet();

alter table public.pallets enable row level security;
alter table public.racks enable row level security;
alter table public.rack_packs enable row level security;
alter table public.lifecycle_events enable row level security;
drop policy if exists "Read lifecycle pallets" on public.pallets;
create policy "Read lifecycle pallets" on public.pallets for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Read lifecycle racks" on public.racks;
create policy "Read lifecycle racks" on public.racks for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Read lifecycle rack packs" on public.rack_packs;
create policy "Read lifecycle rack packs" on public.rack_packs for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));
drop policy if exists "Read lifecycle events" on public.lifecycle_events;
create policy "Read lifecycle events" on public.lifecycle_events for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));

-- Controllers remain assigned whenever their reservation points at a battery.
-- This also repairs rows written before the assignment status was enforced.
update public.bms_units
set status = 'ASSIGNED', updated_at = now()
where reserved_for_battery_id is not null
    and status = 'AVAILABLE';

update public.bmu_units
set status = 'ASSIGNED', updated_at = now()
where reserved_for_battery_id is not null
    and status = 'AVAILABLE';

create or replace function public.sync_controller_assignment_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
        if new.reserved_for_battery_id is not null then
                new.status := 'ASSIGNED';
        elsif tg_op = 'UPDATE' and new.reserved_for_battery_id is null and old.reserved_for_battery_id is not null and new.status = 'ASSIGNED' then
                new.status := 'AVAILABLE';
        end if;
        return new;
end;
$$;

drop trigger if exists trg_sync_bms_assignment_status on public.bms_units;
create trigger trg_sync_bms_assignment_status
before insert or update of reserved_for_battery_id, status on public.bms_units
for each row execute function public.sync_controller_assignment_status();

drop trigger if exists trg_sync_bmu_assignment_status on public.bmu_units;
create trigger trg_sync_bmu_assignment_status
before insert or update of reserved_for_battery_id, status on public.bmu_units
for each row execute function public.sync_controller_assignment_status();

drop policy if exists "Read Genealogy" on public.genealogy_records;
create policy "Read Genealogy" on public.genealogy_records for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));

-- Safe template and orphan cleanup from the former repair script.
update public.product_templates set cells_per_module = 12, num_modules = 2, total_cells = 24, updated_at = now()
where active = true and (name ilike '%7.5%' or capacity_kwh = 7.5 or battery_name ilike '%7.5%');
with ranked as (
    select module_id, cell_id, cell_slot_index, row_number() over (partition by cell_id order by assigned_at asc nulls last, module_id asc) as rn
    from public.module_cells
)
delete from public.module_cells mc using ranked r
where mc.module_id = r.module_id and mc.cell_id = r.cell_id and mc.cell_slot_index = r.cell_slot_index and r.rn > 1;
update public.bmu_units set reserved_for_battery_id = null, status = 'AVAILABLE', updated_at = now()
where reserved_for_battery_id is not null and reserved_for_battery_id not in (select id from public.batteries);
update public.bms_units set reserved_for_battery_id = null, status = 'AVAILABLE', updated_at = now()
where reserved_for_battery_id is not null and reserved_for_battery_id not in (select id from public.batteries);
update public.cells c set status = 'AVAILABLE', lifecycle_status = 'FLOOR_STOCK', reserved_for_battery_id = null, reserved_for_order_id = null, updated_at = now()
where c.id in (select mc.cell_id from public.module_cells mc left join public.modules m on m.id = mc.module_id left join public.batteries b on b.id = m.battery_id where m.id is null or b.id is null);

-- Return cells left behind by deleted standalone modules to floor stock.
update public.cells c
set status = 'AVAILABLE', lifecycle_status = 'FLOOR_STOCK', updated_at = now()
where c.lifecycle_status = 'IN_MODULE'
    and c.reserved_for_battery_id is null
    and not exists (select 1 from public.module_cells mc where mc.cell_id = c.id);

-- Reconcile cells assigned to standalone modules. The module relationship is
-- authoritative when the module has no battery assignment.
update public.cells c
set status = case when c.status in ('IMPORTED', 'AVAILABLE', 'RESERVED') then 'PASSED' else c.status end,
    lifecycle_status = 'IN_MODULE',
    updated_at = now()
where exists (
    select 1
    from public.module_cells mc
    join public.modules m on m.id = mc.module_id
    where mc.cell_id = c.id
      and m.battery_id is null
)
and c.lifecycle_status not in ('IN_PACK', 'IN_RACK', 'SOLD', 'SCRAP');

-- Reconcile bulk imports created before bulk orders were finalized correctly.
update public.production_orders o
set quantity_completed = (select count(*) from public.batteries b where b.production_order_id = o.id),
        quantity_in_process = 0,
        status = 'COMPLETED',
        updated_at = now()
where o.status = 'IN_PROCESS'
    and o.order_number like 'PO-BULK-%'
    and exists (select 1 from public.batteries b where b.production_order_id = o.id)
    and not exists (
            select 1 from public.batteries b
            where b.production_order_id = o.id
                and b.status not in ('FINISHED','RELEASED','DISPATCHED','WAREHOUSE')
    );

-- Final dashboard summary definition. This is the single source of truth for CEO metrics.
alter table public.cells add column if not exists lifecycle_status text default 'IN_STOCK';
alter table public.modules add column if not exists lifecycle_status text default 'IN_MODULE';
alter table public.batteries add column if not exists lifecycle_status text default 'IN_PACK';

create or replace function public.get_dashboard_summary()
returns jsonb language sql security definer set search_path = public as $$
with cell_counts as (
    select
        count(*)::int as total,
        count(*) filter (where lifecycle_status in ('IN_STOCK','FLOOR_STOCK') and reserved_for_order_id is null and reserved_for_battery_id is null)::int as available,
        count(*) filter (where lifecycle_status = 'IN_STOCK' and reserved_for_order_id is null and reserved_for_battery_id is null)::int as in_stock,
        count(*) filter (where lifecycle_status = 'FLOOR_STOCK' and reserved_for_order_id is null and reserved_for_battery_id is null)::int as floor_stock,
        count(*) filter (where (lifecycle_status = 'IN_MODULE' or exists (select 1 from public.module_cells mc where mc.cell_id = cells.id))
            and not exists (select 1 from public.batteries b
                where b.id = coalesce(cells.reserved_for_battery_id, (select m.battery_id from public.module_cells mc join public.modules m on m.id = mc.module_id where mc.cell_id = cells.id limit 1))
                and (b.progress_percent >= 100 or b.status in ('RELEASED','WAREHOUSE','DISPATCHED','FINISHED')))
            and lifecycle_status not in ('IN_PACK','IN_RACK','SOLD','SCRAP'))::int as assembled,
        count(*) filter (where lifecycle_status = 'IN_PACK' or exists (select 1 from public.batteries b
            where b.id = coalesce(cells.reserved_for_battery_id, (select m.battery_id from public.module_cells mc join public.modules m on m.id = mc.module_id where mc.cell_id = cells.id limit 1))
            and (b.progress_percent >= 100 or b.status in ('RELEASED','WAREHOUSE','DISPATCHED','FINISHED'))))::int as in_pack,
        count(*) filter (where lifecycle_status = 'IN_RACK')::int as in_rack,
        count(*) filter (where lifecycle_status = 'SOLD')::int as sold,
        count(*) filter (where lifecycle_status = 'SCRAP' or status in ('QUARANTINED','REJECTED'))::int as quarantined,
        count(*) filter (where status = 'RESERVED' or reserved_for_order_id is not null or reserved_for_battery_id is not null)::int as reserved,
        count(*) filter (where status in ('IN_PROCESS','VALIDATING','TESTING','SCANNED','PASSED'))::int as in_process
    from public.cells
), battery_counts as (
    select
        count(*) filter (where status in ('FINISHED','RELEASED','DISPATCHED'))::int as finished,
        count(*) filter (where status in ('CREATED','ASSEMBLY','TESTING','QC','IN_PROCESS'))::int as in_process
    from public.batteries
), order_counts as (
    select count(*)::int as total,
        count(*) filter (where status = 'IN_PROCESS')::int as in_process,
        count(*) filter (where status = 'COMPLETED')::int as completed,
        count(*) filter (where status = 'PLANNED')::int as planned
    from public.production_orders
), machine_counts as (
    select count(*)::int as total, count(*) filter (where status in ('ONLINE','BUSY'))::int as online
    from public.machine_configurations
), quality_counts as (
    select count(*) filter (where passed = true)::int as passed, count(*)::int as total from public.battery_tests
), production_counts as (
    select
        (select coalesce(sum(case when b.status in ('FINISHED','RELEASED','DISPATCHED','WAREHOUSE') then p.capacity_kwh else 0 end), 0)::numeric from public.batteries b join public.product_templates p on p.id = b.product_id) as capacity_produced_kwh,
        (select count(*)::int from public.batteries b where b.status in ('FINISHED','RELEASED','DISPATCHED','WAREHOUSE')) as completed_batteries,
        coalesce(sum(o.target_quantity), 0)::int as target_batteries,
        coalesce(sum(o.quantity_completed), 0)::int as completed_order_batteries,
        coalesce(sum(o.target_quantity * p.capacity_kwh), 0)::numeric as target_capacity_kwh
    from public.production_orders o
    join public.product_templates p on p.id = o.product_id
), attention_counts as (
    select
        (select count(*)::int from public.quarantine_records where status = 'OPEN') as open_quarantines,
        (select count(*)::int from public.machine_configurations where status not in ('ONLINE','BUSY')) as offline_machines,
        (select count(*)::int from public.production_orders where status = 'IN_PROCESS' and quantity_in_process > 0 and updated_at < now() - interval '24 hours') as delayed_orders,
        (select count(*)::int from public.battery_tests where passed = false) + (select count(*)::int from public.module_tests where passed = false) as qc_issues
), summary as (
    select c.total, c.available, c.in_stock, c.floor_stock, c.assembled, c.in_pack, c.in_rack, c.sold, c.quarantined, c.reserved, c.in_process,
        b.finished, b.in_process as batteries_in_process,
        o.total as orders_total, o.in_process as orders_in_process, o.completed as orders_completed, o.planned as orders_planned,
        m.total as machines_total, m.online as machines_online,
        q.passed as quality_passed, q.total as quality_total,
        pc.capacity_produced_kwh, pc.completed_batteries, pc.target_batteries, pc.completed_order_batteries, pc.target_capacity_kwh,
        ac.open_quarantines, ac.offline_machines, ac.delayed_orders, ac.qc_issues
    from cell_counts c, battery_counts b, order_counts o, machine_counts m, quality_counts q, production_counts pc, attention_counts ac
)
select jsonb_build_object(
    'inventory', jsonb_build_object(
        'totalCells', total, 'availableCells', available, 'inStockCells', in_stock, 'floorStockCells', floor_stock, 'inModuleCells', assembled, 'inPackCells', in_pack, 'inRackCells', in_rack, 'soldCells', sold, 'scrapCells', quarantined, 'usedCells', total - available,
        'reservedCells', reserved, 'inProcessCells', in_process, 'assembledCells', assembled,
        'quarantinedCells', quarantined, 'finishedBatteries', finished, 'inProcessBatteries', batteries_in_process,
        'availableBms', (select count(*) from public.bms_units where status = 'AVAILABLE' and reserved_for_battery_id is null),
        'availableBmu', (select count(*) from public.bmu_units where status = 'AVAILABLE' and reserved_for_battery_id is null),
        'totalBms', (select count(*) from public.bms_units), 'totalBmu', (select count(*) from public.bmu_units)
    ),
    'quality', jsonb_build_object('firstPassYieldPercent', coalesce(round(100.0 * quality_passed / nullif(quality_total, 0), 1), 0), 'passedTests', quality_passed, 'totalTests', quality_total, 'quarantinedCount', (select count(*)::int from public.quarantine_records where status = 'OPEN')),
    'orders', jsonb_build_object('total', orders_total, 'inProcess', orders_in_process, 'completed', orders_completed, 'planned', orders_planned),
    'production', jsonb_build_object(
        'capacityProducedKwh', capacity_produced_kwh,
        'targetCapacityKwh', target_capacity_kwh,
        'completedBatteries', completed_batteries,
        'targetBatteries', target_batteries,
        'completedOrderBatteries', completed_order_batteries
    ),
    'attention', jsonb_build_object(
        'openQuarantines', open_quarantines,
        'offlineMachines', offline_machines,
        'delayedOrders', delayed_orders,
        'qcIssues', qc_issues
    ),
    'updatedAt', now(),
    'kpis', jsonb_build_object('totalCellsInInventory', total, 'availableCells', available, 'usedCells', total - available, 'reservedCells', reserved, 'inProcessCells', in_process, 'assembledCells', assembled, 'quarantinedCells', quarantined, 'totalBatteriesCompleted', finished, 'batteriesInProduction', batteries_in_process, 'activeOrders', orders_in_process, 'firstPassYield', coalesce(round(100.0 * quality_passed / nullif(quality_total, 0), 1), 0), 'onlineMachines', machines_online, 'totalMachines', machines_total),
    'machines', coalesce((select jsonb_agg(to_jsonb(m) - 'created_at' - 'updated_at' order by m.name) from public.machine_configurations m), '[]'::jsonb),
    'cellBuckets', jsonb_build_array(jsonb_build_object('label','In Stock','value',in_stock), jsonb_build_object('label','Floor Stock','value',floor_stock), jsonb_build_object('label','In Module','value',assembled), jsonb_build_object('label','In Pack','value',in_pack), jsonb_build_object('label','In Rack','value',in_rack), jsonb_build_object('label','Sold','value',sold), jsonb_build_object('label','Scrap','value',quarantined)),
    'moduleStatusBuckets', jsonb_build_array(
        jsonb_build_object('label', 'Available', 'value', (select count(*)::int from public.modules where lifecycle_status = 'IN_MODULE')),
        jsonb_build_object('label', 'In Pack', 'value', (select count(*)::int from public.modules where lifecycle_status = 'IN_PACK')),
        jsonb_build_object('label', 'In Rack', 'value', (select count(*)::int from public.modules where lifecycle_status = 'IN_RACK'))
    ),
    'batteryStatusBuckets', jsonb_build_array(
        jsonb_build_object('label', 'Available', 'value', (select count(*)::int from public.batteries where lifecycle_status = 'IN_PACK')),
        jsonb_build_object('label', 'In Rack', 'value', (select count(*)::int from public.batteries where lifecycle_status = 'IN_RACK')),
        jsonb_build_object('label', 'Sold', 'value', (select count(*)::int from public.batteries where lifecycle_status = 'SOLD'))
    ),
    'batteryPackBuckets', coalesce((select jsonb_agg(jsonb_build_object('label', pack_name, 'value', pack_count) order by pack_name)
        from (select p.name as pack_name, count(b.id)::int as pack_count
              from public.product_templates p
              left join public.batteries b on b.product_id = p.id
              where p.active = true
              group by p.id, p.name) pack_counts), '[]'::jsonb),
    'batteryPackTrend', coalesce((select jsonb_agg(jsonb_build_object('label', day_label, 'series', series) order by day_label)
        from (
            select day_label, jsonb_agg(jsonb_build_object('name', pack_name, 'value', amount) order by pack_name) as series
            from (
                select to_char(days.day, 'YYYY-MM-DD') as day_label, p.name as pack_name, count(b.id)::int as amount
                from generate_series(current_date - 29, current_date, interval '1 day') as days(day)
                cross join public.product_templates p
                left join public.batteries b on b.product_id = p.id
                    and b.status in ('FINISHED','RELEASED','DISPATCHED')
                    and b.created_at::date = days.day
                where p.active = true
                group by days.day, p.name
            ) daily_pack_counts
            group by day_label
        ) daily_pack_series), '[]'::jsonb),
    'rackStatusBuckets', coalesce((select jsonb_agg(jsonb_build_object('label', status, 'value', amount) order by status) from (select status, count(*)::int as amount from public.racks group by status) rack_counts), '[]'::jsonb),
    'recentBatteries', coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'serialNumber',b.serial_number,'productName',p.name,'currentStep',b.current_step,'progressPercent',b.progress_percent,'status',b.status) order by b.created_at desc) from public.batteries b join public.product_templates p on p.id = b.product_id limit 20), '[]'::jsonb),
    'recentOrders', coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc) from public.production_orders o limit 20), '[]'::jsonb),
    'recentAuditLogs', coalesce((select jsonb_agg(to_jsonb(a) order by a.timestamp desc) from public.audit_logs a limit 20), '[]'::jsonb),
    'batteryBuildTrend', coalesce((select jsonb_agg(jsonb_build_object('label',day_label,'value',amount) order by day_label) from (select to_char(created_at,'YYYY-MM-DD') as day_label,count(*) as amount from public.batteries where status in ('FINISHED','RELEASED','DISPATCHED') group by 1 order by 1 desc limit 7) trend), '[]'::jsonb),
    'finishedPackTrend', coalesce((select jsonb_agg(jsonb_build_object('label',day_label,'value',amount) order by day_label) from (select to_char(created_at,'YYYY-MM-DD') as day_label,count(*) as amount from public.batteries where status in ('FINISHED','RELEASED','DISPATCHED') group by 1 order by 1 desc limit 7) trend), '[]'::jsonb),
    'quarantineOpenCount', (select count(*)::int from public.quarantine_records where status = 'OPEN')
) from summary;
$$;
revoke all on function public.get_dashboard_summary() from public;
revoke all on function public.get_dashboard_summary() from anon;
grant execute on function public.get_dashboard_summary() to authenticated;

-- Release cell reservations before a battery delete removes the foreign-key reference.
create or replace function public.release_deleted_battery_cells()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    update public.cells
    set status = 'AVAILABLE', lifecycle_status = 'IN_STOCK', updated_at = now()
    where reserved_for_battery_id = old.id;
    return old;
end;
$$;

drop trigger if exists release_cells_before_battery_delete on public.batteries;
create trigger release_cells_before_battery_delete
before delete on public.batteries
for each row execute function public.release_deleted_battery_cells();

-- One-time operational data reset. This preserves users, roles, permissions,
-- suppliers, products, and machine configuration.
create or replace function public.reset_operational_data()
returns void language plpgsql security definer set search_path = public as $$
begin
    perform public.require_permission('MANAGE_USERS');
    truncate table
        public.module_cells,
        public.module_tests,
        public.cell_tests,
        public.controller_tests,
        public.battery_tests,
        public.release_records,
        public.dispatches,
        public.warehouse_movements,
        public.quarantine_records,
        public.lifecycle_events,
        public.genealogy_records,
        public.audit_logs,
        public.supplier_import_rows,
        public.qr_registry,
        public.modules,
        public.batteries,
        public.cells,
        public.production_orders,
        public.supplier_imports,
        public.rack_packs,
        public.racks,
        public.bms_units,
        public.bmu_units,
        public.pallets
    restart identity;
end;
$$;

revoke all on function public.reset_operational_data() from public;
revoke all on function public.reset_operational_data() from anon;
grant execute on function public.reset_operational_data() to authenticated;

-- ================================================================
-- END OF AUTHORITATIVE SCHEMA
-- ================================================================

-- Keep module lifecycle status aligned with battery assignment.
update public.modules
set lifecycle_status = case when battery_id is null then 'IN_STOCK' else 'IN_PACK' end,
    updated_at = now()
where lifecycle_status = 'IN_MODULE';

create or replace function public.sync_module_lifecycle_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if new.battery_id is null and coalesce(new.lifecycle_status, '') = 'IN_MODULE' then
        new.lifecycle_status := 'IN_STOCK';
    elsif new.battery_id is not null and coalesce(new.lifecycle_status, '') in ('IN_STOCK', 'IN_MODULE') then
        new.lifecycle_status := 'IN_PACK';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_sync_module_lifecycle_status on public.modules;
create trigger trg_sync_module_lifecycle_status
before insert or update of battery_id, lifecycle_status on public.modules
for each row execute function public.sync_module_lifecycle_status();
