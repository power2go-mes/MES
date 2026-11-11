-- Hotfix Migration: 20261111_fix_assemble_rack_for_update.sql
-- Fixes PostgreSQL error: "FOR UPDATE cannot be applied to the nullable side of an outer join"
-- in assemble_rack_transaction by scoping row locking specifically to public.batteries (FOR UPDATE OF b).

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

