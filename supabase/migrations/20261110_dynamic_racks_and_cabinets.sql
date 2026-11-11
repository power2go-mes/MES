-- Migration: 20261110_dynamic_racks_and_cabinets.sql
-- Enables dynamic LV/HV Rack and Cabinet Shell Bodies with flexible battery pack counts.

-- 1. Create table for Rack & Cabinet Shell Body Templates
create table if not exists public.rack_shell_templates (
    id text primary key,
    name text not null,
    shell_code text not null unique,
    shell_type text not null check (shell_type in ('RACK', 'CABINET')),
    voltage_type text not null check (voltage_type in ('LV', 'HV')),
    max_slots integer not null check (max_slots >= 1 and max_slots <= 20),
    nominal_capacity_kwh numeric(6,2) not null check (nominal_capacity_kwh > 0),
    description text,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- RLS & Policies
alter table public.rack_shell_templates enable row level security;
drop policy if exists "Read rack shell templates" on public.rack_shell_templates;
create policy "Read rack shell templates" on public.rack_shell_templates for select using (true);

drop policy if exists "Manage rack shell templates" on public.rack_shell_templates;
create policy "Manage rack shell templates" on public.rack_shell_templates for all using (
    public.has_permission('MANAGE_PRODUCTION') or public.has_permission('ALL')
);

-- 2. Seed standard default shell templates (Racks & Cabinets)
insert into public.rack_shell_templates (id, name, shell_code, shell_type, voltage_type, max_slots, nominal_capacity_kwh, description)
values
    ('shell-rack-25kwh-lv', '25 kWh LV Rack Frame', 'SHELL_RACK_25KWH_LV', 'RACK', 'LV', 5, 25.0, 'Standard 5-slot Low-Voltage (LV) open battery rack frame for 5 kWh packs'),
    ('shell-cab-25kwh-lv', '25 kWh LV Cabinet Enclosure', 'SHELL_CAB_25KWH_LV', 'CABINET', 'LV', 5, 25.0, 'Enclosed 5-slot Low-Voltage (LV) battery cabinet for 5 kWh packs'),
    ('shell-cab-45kwh-hv', '45 kWh HV Cabinet Enclosure', 'SHELL_CAB_45KWH_HV', 'CABINET', 'HV', 6, 45.0, 'Enclosed 6-slot High-Voltage (HV) battery cabinet for 7.5 kWh packs'),
    ('shell-cab-60kwh-hv', '60 kWh HV Cabinet Enclosure', 'SHELL_CAB_60KWH_HV', 'CABINET', 'HV', 8, 60.0, 'Enclosed 8-slot High-Voltage (HV) battery cabinet for 7.5 kWh packs'),
    ('shell-cab-70kwh-hv', '67.5 kWh HV Cabinet Enclosure', 'SHELL_CAB_70KWH_HV', 'CABINET', 'HV', 9, 67.5, 'Enclosed 9-slot High-Voltage (HV) battery cabinet for 7.5 kWh packs'),
    ('shell-cab-75kwh-hv', '75 kWh HV Cabinet Enclosure', 'SHELL_CAB_75KWH_HV', 'CABINET', 'HV', 10, 75.0, 'Enclosed 10-slot High-Voltage (HV) battery cabinet for 7.5 kWh packs')
on conflict (id) do update set
    name = excluded.name,
    shell_code = excluded.shell_code,
    shell_type = excluded.shell_type,
    voltage_type = excluded.voltage_type,
    max_slots = excluded.max_slots,
    nominal_capacity_kwh = excluded.nominal_capacity_kwh,
    description = excluded.description,
    active = true,
    updated_at = now();

-- 3. Add dynamic metadata columns to public.racks
alter table public.racks
    add column if not exists shell_template_id text references public.rack_shell_templates(id),
    add column if not exists shell_type text default 'RACK',
    add column if not exists voltage_type text default 'LV',
    add column if not exists actual_capacity_kwh numeric(6,2),
    add column if not exists installed_pack_count integer,
    add column if not exists max_pack_capacity integer;

-- Relax old check constraint so dynamic capacities (e.g. RACK_15KWH, CABINET_15KWH, etc.) are allowed
alter table public.racks drop constraint if exists racks_rack_template_code_check;

-- 4. Safely backfill all 25 existing racks
update public.racks
set
    shell_template_id = 'shell-rack-25kwh-lv',
    shell_type = 'RACK',
    voltage_type = 'LV',
    actual_capacity_kwh = 25.0,
    installed_pack_count = 5,
    max_pack_capacity = 5
where rack_template_code = 'RACK_25KWH' and shell_template_id is null;

update public.racks
set
    shell_template_id = 'shell-cab-45kwh-hv',
    shell_type = 'CABINET',
    voltage_type = 'HV',
    actual_capacity_kwh = 45.0,
    installed_pack_count = 6,
    max_pack_capacity = 6
where rack_template_code = 'RACK_45KWH' and shell_template_id is null;

update public.racks
set
    shell_template_id = 'shell-cab-60kwh-hv',
    shell_type = 'CABINET',
    voltage_type = 'HV',
    actual_capacity_kwh = 60.0,
    installed_pack_count = 8,
    max_pack_capacity = 8
where rack_template_code = 'RACK_60KWH' and shell_template_id is null;

update public.racks
set
    shell_template_id = 'shell-cab-70kwh-hv',
    shell_type = 'CABINET',
    voltage_type = 'HV',
    actual_capacity_kwh = 67.5,
    installed_pack_count = 9,
    max_pack_capacity = 9
where (rack_template_code = 'RACK_70KWH' or rack_template_code = 'RACK_67.5KWH') and shell_template_id is null;

-- 5. Upgraded assemble_rack_transaction function
drop function if exists public.assemble_rack_transaction(text, text[], text);
drop function if exists public.assemble_rack_transaction(text, text[], text, text);
create or replace function public.assemble_rack_transaction(
    p_template_code text,
    p_battery_ids text[],
    p_location text default null,
    p_shell_template_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_rack_id text := 'rack-' || gen_random_uuid();
    v_serial text;
    v_battery record;
    v_next_number integer;
    v_index integer;
    v_pack_count integer;
    v_shell public.rack_shell_templates%rowtype;
    v_shell_type text := 'RACK';
    v_voltage_type text := 'LV';
    v_pack_code text := 'PACK_5KWH';
    v_pack_kwh numeric(6,2) := 5.0;
    v_actual_kwh numeric(6,2);
    v_max_slots integer := 5;
    v_power_label text;
    v_serial_prefix text;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    v_pack_count := coalesce(array_length(p_battery_ids, 1), 0);
    if v_pack_count < 1 then
        raise exception 'At least 1 battery pack is required to assemble a rack/cabinet.';
    end if;

    -- Lookup shell template if provided
    if p_shell_template_id is not null and p_shell_template_id <> '' then
        select * into v_shell from public.rack_shell_templates where id = p_shell_template_id or shell_code = p_shell_template_id;
        if found then
            v_shell_type := v_shell.shell_type;
            v_voltage_type := v_shell.voltage_type;
            v_max_slots := v_shell.max_slots;
        end if;
    end if;

    -- If not found via ID, deduce from template code
    if v_shell.id is null then
        if p_template_code like '%CAB%' or p_template_code in ('RACK_45KWH', 'RACK_60KWH', 'RACK_70KWH', 'RACK_75KWH') then
            v_shell_type := 'CABINET';
        else
            v_shell_type := 'RACK';
        end if;

        if p_template_code in ('RACK_45KWH', 'RACK_60KWH', 'RACK_70KWH', 'RACK_75KWH') or p_template_code like '%HV%' then
            v_voltage_type := 'HV';
            v_max_slots := case
                when p_template_code = 'RACK_45KWH' then 6
                when p_template_code = 'RACK_60KWH' then 8
                when p_template_code = 'RACK_70KWH' then 9
                when p_template_code = 'RACK_75KWH' then 10
                else 10
            end;
        else
            v_voltage_type := 'LV';
            v_max_slots := 5;
        end if;
    end if;

    if v_pack_count > v_max_slots then
        raise exception 'Selected shell accepts at most % packs (received %)', v_max_slots, v_pack_count;
    end if;

    -- Determine pack capacity and expected code based on voltage tier
    if v_voltage_type = 'HV' then
        v_pack_code := 'PACK_7_5KWH';
        v_pack_kwh := 7.5;
    else
        v_pack_code := 'PACK_5KWH';
        v_pack_kwh := 5.0;
    end if;

    v_actual_kwh := v_pack_count * v_pack_kwh;
    if v_actual_kwh = floor(v_actual_kwh) then
        v_power_label := (v_actual_kwh::integer)::text;
    else
        v_power_label := trim(to_char(v_actual_kwh, 'FM999.0'));
    end if;

    -- Concurrency safe advisory lock
    perform pg_advisory_xact_lock(hashtext('P2G-rack-serials'));

    -- Determine serial prefix (RACK vs CAB)
    if v_shell_type = 'CABINET' then
        v_serial_prefix := 'P2G-CAB-' || v_power_label || 'KWH-' || to_char(current_date, 'DDMM');
    else
        v_serial_prefix := 'P2G-RACK-' || v_power_label || 'KWH-' || to_char(current_date, 'DDMM');
    end if;

    select coalesce(max((substring(serial_number from '([0-9]+)$'))::integer), 0) + 1
      into v_next_number
      from public.racks
     where serial_number like v_serial_prefix || '-%';

    v_serial := v_serial_prefix || '-' || lpad(v_next_number::text, 4, '0');

    -- Validate batteries
    if exists (select 1 from public.rack_packs where battery_id = any(p_battery_ids)) then
        raise exception 'One or more packs are already assigned to an existing rack/cabinet.';
    end if;

    if (select count(*) from public.batteries where id = any(p_battery_ids)) <> v_pack_count then
        raise exception 'All requested battery packs must exist in the database.';
    end if;

    for v_battery in
        select b.*, p.capacity_kwh
          from public.batteries b
          left join public.product_templates p on p.id = b.product_id
         where b.id = any(p_battery_ids)
         for update of b
    loop
        if v_voltage_type = 'LV' and (
            coalesce(v_battery.pack_template_code, '') = 'PACK_7_5KWH'
            or coalesce(v_battery.capacity_kwh, 5.0) >= 7.0
        ) then
            raise exception 'Pack % (7.5 kWh) is not compatible with an LV rack. Only 5 kWh packs allowed.', v_battery.serial_number;
        end if;
        if v_voltage_type = 'HV' and (
            coalesce(v_battery.pack_template_code, '') = 'PACK_5KWH'
            or coalesce(v_battery.capacity_kwh, 7.5) < 7.0
        ) then
            raise exception 'Pack % (5 kWh) is not compatible with an HV cabinet. Only 7.5 kWh packs allowed.', v_battery.serial_number;
        end if;
        if v_battery.status not in ('RELEASED', 'FINISHED', 'WAREHOUSE') then
            raise exception 'Pack % is not in a released/finished status.', v_battery.serial_number;
        end if;
    end loop;

    -- Insert new rack
    insert into public.racks (
        id,
        serial_number,
        qr_code,
        rack_template_code,
        status,
        required_pack_count,
        required_pack_template_code,
        location,
        created_by,
        shell_template_id,
        shell_type,
        voltage_type,
        actual_capacity_kwh,
        installed_pack_count,
        max_pack_capacity
    ) values (
        v_rack_id,
        v_serial,
        'RACK-QR-' || upper(substr(replace(v_rack_id, '-', ''), 1, 12)),
        coalesce(nullif(p_template_code, ''), (v_shell_type || '_' || v_power_label || 'KWH')),
        'IN_STOCK',
        v_pack_count,
        v_pack_code,
        coalesce(nullif(trim(p_location), ''), 'RACK_ASSEMBLY'),
        auth.uid(),
        v_shell.id,
        v_shell_type,
        v_voltage_type,
        v_actual_kwh,
        v_pack_count,
        v_max_slots
    );

    insert into public.qr_registry (qr_code, entity_type, entity_id)
    values ('RACK-QR-' || upper(substr(replace(v_rack_id, '-', ''), 1, 12)), 'RACK', v_rack_id)
    on conflict (qr_code) do nothing;

    -- Assign pack slots and update lifecycle statuses
    for v_index in 1..v_pack_count loop
        insert into public.rack_packs(rack_id, battery_id, pack_slot_index)
        values (v_rack_id, p_battery_ids[v_index], v_index - 1);

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

    insert into public.lifecycle_events(entity_type, entity_id, from_status, to_status, reason, recorded_by)
    values ('RACK', v_rack_id, 'IN_STOCK', 'IN_STOCK', 'Rack assembled with ' || v_pack_count || ' packs (' || v_actual_kwh || ' kWh)', auth.uid());

    perform public.record_genealogy_event('RACK', v_rack_id, 'ASSEMBLED', null, null, jsonb_build_object(
        'shell_template', coalesce(v_shell.name, p_template_code),
        'shell_type', v_shell_type,
        'voltage_type', v_voltage_type,
        'actual_capacity_kwh', v_actual_kwh,
        'battery_count', v_pack_count
    ));

    return jsonb_build_object(
        'rackId', v_rack_id,
        'serialNumber', v_serial,
        'qrCode', 'RACK-QR-' || upper(substr(replace(v_rack_id, '-', ''), 1, 12)),
        'status', 'IN_STOCK',
        'actualCapacityKwh', v_actual_kwh,
        'installedPackCount', v_pack_count,
        'shellType', v_shell_type,
        'voltageType', v_voltage_type
    );
end $$;
