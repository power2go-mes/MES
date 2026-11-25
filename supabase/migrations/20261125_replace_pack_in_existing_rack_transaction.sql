-- Atomically replaces one installed pack while preserving the rack and slot identity.
-- The removed pack and its modules/cells return to IN_STOCK lifecycle status.
create or replace function public.replace_pack_in_existing_rack_transaction(
    p_rack_id text,
    p_slot_index integer,
    p_new_battery_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_rack public.racks%rowtype;
    v_old_battery_id text;
    v_old_battery public.batteries%rowtype;
    v_new_battery record;
    v_voltage_type text;
    v_pack_code text;
    v_pack_kwh numeric(6,2);
    v_max_slots integer;
    v_pack_count integer;
    v_updated_ids jsonb;
begin
    perform public.require_permission('MANAGE_PRODUCTION');

    if nullif(trim(p_rack_id), '') is null or nullif(trim(p_new_battery_id), '') is null then
        raise exception 'Rack ID and replacement pack ID are required.';
    end if;
    if p_slot_index is null or p_slot_index < 0 then
        raise exception 'A valid zero-based rack slot is required.';
    end if;

    select * into v_rack
      from public.racks
     where id = p_rack_id
     for update;
    if not found then raise exception 'Rack % was not found.', p_rack_id; end if;
    if v_rack.status <> 'IN_STOCK' then
        raise exception 'Only an in-stock rack can be edited. Current status: %.', v_rack.status;
    end if;
    if nullif(trim(coalesce(v_rack.issued_to_person, '')), '') is not null then
        raise exception 'This rack is currently issued and cannot be edited.';
    end if;
    v_voltage_type := upper(coalesce(v_rack.voltage_type,
        case when v_rack.required_pack_template_code = 'PACK_7_5KWH' then 'HV' else 'LV' end));
    if v_voltage_type not in ('LV', 'HV') then
        raise exception 'Rack voltage type is invalid and cannot be edited safely.';
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

    if p_slot_index >= v_max_slots then
        raise exception 'Slot % is outside this rack''s % physical slots.', p_slot_index + 1, v_max_slots;
    end if;

    select battery_id into v_old_battery_id
      from public.rack_packs
     where rack_id = p_rack_id and pack_slot_index = p_slot_index
     for update;
    if not found then raise exception 'There is no installed pack in slot %.', p_slot_index + 1; end if;
    if v_old_battery_id = p_new_battery_id then
        raise exception 'The selected pack is already installed in this slot.';
    end if;

    -- Lock both battery records in stable ID order before validating assignment.
    perform b.id
      from public.batteries b
     where b.id in (v_old_battery_id, p_new_battery_id)
     order by b.id
     for update;

    select * into v_old_battery
      from public.batteries
     where id = v_old_battery_id;
    if nullif(trim(coalesce(v_old_battery.issued_to_person, '')), '') is not null then
        raise exception 'The installed pack is issued and cannot be removed from the rack.';
    end if;

    if exists (select 1 from public.rack_packs where battery_id = p_new_battery_id) then
        raise exception 'The replacement pack is already assigned to a rack/cabinet.';
    end if;

    select b.id, b.serial_number, b.status, b.pack_template_code, b.issued_to_person, pt.capacity_kwh
      into v_new_battery
      from public.batteries b
      left join public.product_templates pt on pt.id = b.product_id
     where b.id = p_new_battery_id;
    if not found then raise exception 'Replacement pack % was not found.', p_new_battery_id; end if;
    if v_new_battery.status not in ('RELEASED', 'FINISHED', 'WAREHOUSE') then
        raise exception 'Replacement pack % is not in released/finished/warehouse status.', v_new_battery.serial_number;
    end if;
    if nullif(trim(coalesce(v_new_battery.issued_to_person, '')), '') is not null then
        raise exception 'Replacement pack % is currently issued.', v_new_battery.serial_number;
    end if;
    if v_voltage_type = 'LV' and (
        coalesce(v_new_battery.pack_template_code, '') = 'PACK_7_5KWH' or
        coalesce(v_new_battery.capacity_kwh, 5.0) >= 7.0
    ) then
        raise exception 'Pack % is not compatible with this LV rack; only 5 kWh packs are allowed.', v_new_battery.serial_number;
    end if;
    if v_voltage_type = 'HV' and (
        coalesce(v_new_battery.pack_template_code, '') = 'PACK_5KWH' or
        coalesce(v_new_battery.capacity_kwh, 7.5) < 7.0
    ) then
        raise exception 'Pack % is not compatible with this HV rack; only 7.5 kWh packs are allowed.', v_new_battery.serial_number;
    end if;

    update public.rack_packs
       set battery_id = p_new_battery_id,
           assigned_at = now()
     where rack_id = p_rack_id and pack_slot_index = p_slot_index;

    -- Keep the underlying enum status (RELEASED/FINISHED/WAREHOUSE) valid;
    -- IN_STOCK is represented by lifecycle_status in this MES.
    update public.batteries
       set lifecycle_status = 'IN_STOCK', updated_at = now()
     where id = v_old_battery_id;
    update public.modules
       set lifecycle_status = 'IN_STOCK', updated_at = now()
     where battery_id = v_old_battery_id;
    update public.cells c
       set lifecycle_status = 'IN_STOCK', updated_at = now()
     where c.reserved_for_battery_id = v_old_battery_id
        or exists (
            select 1
              from public.module_cells mc
              join public.modules m on m.id = mc.module_id
             where mc.cell_id = c.id and m.battery_id = v_old_battery_id
        );

    update public.batteries
       set lifecycle_status = 'IN_RACK', updated_at = now()
     where id = p_new_battery_id;
    update public.modules
       set lifecycle_status = 'IN_RACK', updated_at = now()
     where battery_id = p_new_battery_id;
    update public.cells c
       set lifecycle_status = 'IN_RACK', updated_at = now()
     where c.reserved_for_battery_id = p_new_battery_id
        or exists (
            select 1
              from public.module_cells mc
              join public.modules m on m.id = mc.module_id
             where mc.cell_id = c.id and m.battery_id = p_new_battery_id
        );

    select count(*)::integer into v_pack_count
      from public.rack_packs where rack_id = p_rack_id;
    if v_rack.installed_pack_count is not null and v_rack.installed_pack_count <> v_pack_count then
        raise exception 'Rack pack count does not match its installed pack links; resolve that mismatch before editing.';
    end if;
    update public.racks
       set actual_capacity_kwh = v_pack_count * v_pack_kwh,
           required_pack_count = v_pack_count,
           required_pack_template_code = v_pack_code,
           updated_at = now()
     where id = p_rack_id;

    insert into public.lifecycle_events(entity_type, entity_id, from_status, to_status, reason, recorded_by)
    values (
        'RACK', p_rack_id, v_rack.status, v_rack.status,
        'Replaced pack in slot ' || (p_slot_index + 1) || ': ' || v_old_battery.serial_number || ' → ' || v_new_battery.serial_number,
        auth.uid()
    );
    perform public.record_genealogy_event(
        'BATTERY', v_old_battery_id, 'REMOVED_FROM_RACK', 'RACK', p_rack_id,
        jsonb_build_object('slot_index', p_slot_index, 'returned_lifecycle_status', 'IN_STOCK')
    );
    perform public.record_genealogy_event(
        'BATTERY', p_new_battery_id, 'ASSIGNED_TO_RACK', 'RACK', p_rack_id,
        jsonb_build_object('slot_index', p_slot_index, 'replaced_battery_id', v_old_battery_id)
    );
    perform public.record_genealogy_event(
        'RACK', p_rack_id, 'PACK_REPLACED', null, null,
        jsonb_build_object('slot_index', p_slot_index, 'removed_battery_id', v_old_battery_id, 'added_battery_id', p_new_battery_id)
    );

    select coalesce(jsonb_agg(rp.battery_id order by rp.pack_slot_index), '[]'::jsonb)
      into v_updated_ids
      from public.rack_packs rp
     where rp.rack_id = p_rack_id;

    return jsonb_build_object(
        'rackId', p_rack_id,
        'serialNumber', v_rack.serial_number,
        'qrCode', v_rack.qr_code,
        'installedPackCount', v_pack_count,
        'actualCapacityKwh', v_pack_count * v_pack_kwh,
        'batteryIds', v_updated_ids,
        'removedBatteryId', v_old_battery_id,
        'removedBatterySerial', v_old_battery.serial_number,
        'removedBatteryLifecycleStatus', 'IN_STOCK'
    );
end;
$$;
