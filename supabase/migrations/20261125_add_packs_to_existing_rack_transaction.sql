-- Adds released packs to an existing in-stock rack/cabinet atomically.
-- This is an additive RPC: it does not alter tables or replace the new-rack assembly RPC.
create or replace function public.add_packs_to_existing_rack_transaction(
    p_rack_id text,
    p_battery_ids text[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_rack public.racks%rowtype;
    v_battery record;
    v_voltage_type text;
    v_shell_type text;
    v_pack_code text;
    v_pack_kwh numeric(6,2);
    v_max_slots integer;
    v_current_count integer;
    v_added_count integer := 0;
    v_total_count integer;
    v_actual_kwh numeric(8,2);
    v_power_label text;
    v_slot_index integer;
    v_added_ids text[] := array[]::text[];
    v_all_battery_ids jsonb;
begin
    perform public.require_permission('MANAGE_PRODUCTION');

    if nullif(trim(p_rack_id), '') is null then
        raise exception 'Rack ID is required.';
    end if;
    if p_battery_ids is null or cardinality(p_battery_ids) = 0 then
        raise exception 'Select at least one released battery pack to add.';
    end if;
    if array_position(p_battery_ids, null) is not null or
       (select count(*) from unnest(p_battery_ids) as requested(id)) <>
       (select count(distinct id) from unnest(p_battery_ids) as requested(id)) then
        raise exception 'The selected pack list contains an empty or duplicate ID.';
    end if;

    select * into v_rack
      from public.racks
     where id = p_rack_id
     for update;
    if not found then
        raise exception 'Rack % was not found.', p_rack_id;
    end if;
    if v_rack.status <> 'IN_STOCK' then
        raise exception 'Only an in-stock rack can be edited. Current status: %.', v_rack.status;
    end if;
    if nullif(trim(coalesce(v_rack.issued_to_person, '')), '') is not null then
        raise exception 'This rack is currently issued and cannot be edited.';
    end if;

    v_voltage_type := upper(coalesce(v_rack.voltage_type,
        case when v_rack.required_pack_template_code = 'PACK_7_5KWH' then 'HV' else 'LV' end));
    v_shell_type := upper(coalesce(v_rack.shell_type,
        case when v_rack.rack_template_code like '%CABINET%' then 'CABINET' else 'RACK' end));
    if v_voltage_type not in ('LV', 'HV') then
        raise exception 'Rack voltage type is invalid and cannot be edited safely.';
    end if;
    if v_shell_type not in ('RACK', 'CABINET') then
        raise exception 'Rack shell type is invalid and cannot be edited safely.';
    end if;

    v_pack_code := case when v_voltage_type = 'HV' then 'PACK_7_5KWH' else 'PACK_5KWH' end;
    v_pack_kwh := case when v_voltage_type = 'HV' then 7.5 else 5.0 end;

    select coalesce(
               nullif(v_rack.max_pack_capacity, 0),
               shell.max_slots,
               case
                   when coalesce(v_rack.actual_capacity_kwh, 0) >= 75 then 10
                   when coalesce(v_rack.actual_capacity_kwh, 0) in (52.5, 67.5) then 9
                   when coalesce(v_rack.actual_capacity_kwh, 0) >= 60 then 8
                   when coalesce(v_rack.actual_capacity_kwh, 0) >= 45 then 6
                   when v_voltage_type = 'HV' then 10
                   else 5
               end
           )
      into v_max_slots
      from (select 1) seed
      left join public.rack_shell_templates shell on shell.id = v_rack.shell_template_id;

    select count(*)::integer into v_current_count
      from public.rack_packs
     where rack_id = p_rack_id;
    if v_rack.installed_pack_count is not null and v_rack.installed_pack_count <> v_current_count then
        raise exception 'Rack pack count does not match its installed pack links; resolve that mismatch before editing.';
    end if;
    select count(*)::integer into v_added_count
      from unnest(p_battery_ids) as requested(id);

    if v_current_count >= v_max_slots or v_current_count + v_added_count > v_max_slots then
        raise exception 'This rack has % of % slots filled; % additional pack(s) will not fit.',
            v_current_count, v_max_slots, v_added_count;
    end if;

    if (select count(*) from public.batteries where id = any(p_battery_ids)) <> v_added_count then
        raise exception 'One or more selected packs no longer exist.';
    end if;

    -- Lock pack rows in stable ID order so concurrent edits cannot claim a pack twice.
    perform b.id
      from public.batteries b
     where b.id = any(p_battery_ids)
     order by b.id
     for update;

    if exists (
        select 1
          from public.rack_packs rp
         where rp.battery_id = any(p_battery_ids)
    ) then
        raise exception 'One or more selected packs are already assigned to a rack/cabinet.';
    end if;

    for v_battery in
        select b.id, b.serial_number, b.status, b.pack_template_code, pt.capacity_kwh
          from unnest(p_battery_ids) with ordinality as requested(id, ordinal)
          join public.batteries b on b.id = requested.id
          left join public.product_templates pt on pt.id = b.product_id
         order by requested.ordinal
    loop
        if v_battery.status not in ('RELEASED', 'FINISHED', 'WAREHOUSE') then
            raise exception 'Pack % is not in released/finished/warehouse status.', v_battery.serial_number;
        end if;
        if v_voltage_type = 'LV' and (
            coalesce(v_battery.pack_template_code, '') = 'PACK_7_5KWH' or
            coalesce(v_battery.capacity_kwh, 5.0) >= 7.0
        ) then
            raise exception 'Pack % is not compatible with this LV rack; only 5 kWh packs are allowed.', v_battery.serial_number;
        end if;
        if v_voltage_type = 'HV' and (
            coalesce(v_battery.pack_template_code, '') = 'PACK_5KWH' or
            coalesce(v_battery.capacity_kwh, 7.5) < 7.0
        ) then
            raise exception 'Pack % is not compatible with this HV rack; only 7.5 kWh packs are allowed.', v_battery.serial_number;
        end if;

        select candidate.slot_index into v_slot_index
          from generate_series(0, v_max_slots - 1) as candidate(slot_index)
         where not exists (
             select 1 from public.rack_packs existing
              where existing.rack_id = p_rack_id
                and existing.pack_slot_index = candidate.slot_index
         )
         order by candidate.slot_index
         limit 1;
        if v_slot_index is null then
            raise exception 'No empty physical rack slot remains.';
        end if;

        insert into public.rack_packs(rack_id, battery_id, pack_slot_index)
        values (p_rack_id, v_battery.id, v_slot_index);
        update public.batteries
           set lifecycle_status = 'IN_RACK', updated_at = now()
         where id = v_battery.id;
        update public.modules
           set lifecycle_status = 'IN_RACK', updated_at = now()
         where battery_id = v_battery.id;
        update public.cells c
           set lifecycle_status = 'IN_RACK', updated_at = now()
         where c.reserved_for_battery_id = v_battery.id
            or exists (
                select 1
                  from public.module_cells mc
                  join public.modules m on m.id = mc.module_id
                 where mc.cell_id = c.id and m.battery_id = v_battery.id
            );

        v_added_ids := array_append(v_added_ids, v_battery.id);
        perform public.record_genealogy_event(
            'BATTERY', v_battery.id, 'ASSIGNED_TO_RACK', 'RACK', p_rack_id,
            jsonb_build_object('slot_index', v_slot_index)
        );
    end loop;

    v_total_count := v_current_count + v_added_count;
    v_actual_kwh := v_total_count * v_pack_kwh;
    v_power_label := case
        when v_actual_kwh = floor(v_actual_kwh) then v_actual_kwh::integer::text
        else trim(to_char(v_actual_kwh, 'FM999999990.0'))
    end;

    -- Keep the rack identity, serial, QR, shell, location, and report unchanged.
    -- Update only its live capacity/installed count and compatible template label.
    update public.racks
       set installed_pack_count = v_total_count,
           required_pack_count = v_total_count,
           required_pack_template_code = v_pack_code,
           actual_capacity_kwh = v_actual_kwh,
           rack_template_code = v_shell_type || '_' || v_power_label || 'KWH',
           updated_at = now()
     where id = p_rack_id;

    insert into public.lifecycle_events(entity_type, entity_id, from_status, to_status, reason, recorded_by)
    values (
        'RACK', p_rack_id, v_rack.status, v_rack.status,
        'Added ' || v_added_count || ' battery pack(s); rack now has ' || v_total_count || ' of ' || v_max_slots || ' slots filled.',
        auth.uid()
    );
    perform public.record_genealogy_event(
        'RACK', p_rack_id, 'PACKS_ADDED', null, null,
        jsonb_build_object(
            'added_battery_ids', to_jsonb(v_added_ids),
            'previous_pack_count', v_current_count,
            'installed_pack_count', v_total_count,
            'actual_capacity_kwh', v_actual_kwh
        )
    );

    select coalesce(jsonb_agg(rp.battery_id order by rp.pack_slot_index), '[]'::jsonb)
      into v_all_battery_ids
      from public.rack_packs rp
     where rp.rack_id = p_rack_id;

    return jsonb_build_object(
        'rackId', p_rack_id,
        'serialNumber', v_rack.serial_number,
        'qrCode', v_rack.qr_code,
        'rackTemplateCode', v_shell_type || '_' || v_power_label || 'KWH',
        'status', v_rack.status,
        'installedPackCount', v_total_count,
        'maxPackCapacity', v_max_slots,
        'actualCapacityKwh', v_actual_kwh,
        'batteryIds', v_all_battery_ids,
        'addedBatteryIds', to_jsonb(v_added_ids)
    );
end;
$$;
