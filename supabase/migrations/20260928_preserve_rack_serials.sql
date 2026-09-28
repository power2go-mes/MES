-- Preserve canonical rack serials and migrate only legacy formats.
-- This is safe to run without rerunning the authoritative schema.
do $$
begin
    perform pg_advisory_xact_lock(hashtext('P2G-rack-serials'));

    update public.racks
    set serial_number = 'LEGACY-RACK-' || id
    where serial_number !~ '^P2G-RACK-[0-9]+KWH-[0-9]{4}-[0-9]{4}$';

    with legacy_racks as (
        select
            r.id,
            'P2G-RACK-' || regexp_replace(replace(r.rack_template_code, 'RACK_', ''), 'KWH$', '') || 'KWH-' || to_char(r.created_at, 'DDMM') as serial_prefix,
            r.created_at
        from public.racks r
        where r.serial_number like 'LEGACY-RACK-%'
    ), ranked_racks as (
        select
            legacy.id,
            legacy.serial_prefix,
            row_number() over (
                partition by legacy.serial_prefix
                order by legacy.created_at, legacy.id
            ) + coalesce((
                select max((substring(existing.serial_number from '([0-9]+)$'))::integer)
                from public.racks existing
                where existing.serial_number ~ ('^' || legacy.serial_prefix || '-[0-9]{4}$')
            ), 0) as serial_number
        from legacy_racks legacy
    )
    update public.racks r
    set serial_number = rr.serial_prefix || '-' || lpad(rr.serial_number::text, 4, '0')
    from ranked_racks rr
    where r.id = rr.id;

        -- Older racks may have been assembled with RACK_ASSEMBLY as their location.
        -- Recover their last warehouse from a contained battery pack when available.
        update public.racks r
        set location = locations.warehouse_location
        from (
                select distinct on (rp.rack_id)
                        rp.rack_id,
                        upper(trim(wm.to_location)) as warehouse_location
                from public.rack_packs rp
                join public.batteries b on b.id = rp.battery_id
                join public.warehouse_movements wm
                    on wm.entity_type = 'BATTERY'
                 and wm.entity_id in (b.id, b.serial_number)
                where wm.movement_type <> 'DISPATCH'
                    and upper(trim(wm.to_location)) in ('KARACHI', 'LAHORE')
                order by rp.rack_id, wm.moved_at desc
        ) locations
        where r.id = locations.rack_id
            and upper(trim(coalesce(r.location, ''))) not in ('KARACHI', 'LAHORE');
end $$;

create or replace function public.return_sold_entity_to_warehouse_transaction(
    p_entity_type text,
    p_entity_id text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_entity_type text := upper(trim(p_entity_type));
    v_location text;
    v_battery public.batteries%rowtype;
    v_rack public.racks%rowtype;
begin
    perform public.require_permission('MANAGE_PRODUCTION');

    if v_entity_type = 'BATTERY' then
        select * into v_battery
        from public.batteries
        where id = trim(p_entity_id)
        for update;
        if not found then raise exception 'Battery % not found', p_entity_id; end if;
        if v_battery.lifecycle_status is distinct from 'SOLD' then
            raise exception 'Battery % is not sold', v_battery.serial_number;
        end if;

        select upper(trim(to_location)) into v_location
        from public.warehouse_movements
        where entity_type = 'BATTERY'
          and entity_id in (v_battery.id, v_battery.serial_number)
          and movement_type <> 'DISPATCH'
          and upper(trim(to_location)) in ('KARACHI', 'LAHORE')
        order by moved_at desc
        limit 1;
        if v_location is null then
            raise exception 'No previous Karachi or Lahore warehouse found for battery %', v_battery.serial_number;
        end if;

        update public.batteries
        set status = 'WAREHOUSE', current_step = 'WAREHOUSE', lifecycle_status = 'IN_STOCK', updated_at = now()
        where id = v_battery.id;
        update public.modules
        set lifecycle_status = 'IN_PACK', updated_at = now()
        where battery_id = v_battery.id;
        update public.cells c
        set lifecycle_status = 'IN_PACK', updated_at = now()
        where c.reserved_for_battery_id = v_battery.id
           or exists (
               select 1 from public.module_cells mc
               join public.modules m on m.id = mc.module_id
               where mc.cell_id = c.id and m.battery_id = v_battery.id
           );
        delete from public.sale_history where entity_type = 'BATTERY' and entity_id = v_battery.id;
        insert into public.warehouse_movements (id, entity_type, entity_id, movement_type, from_location, to_location, reference, moved_by, moved_at)
        values ('mov-' || gen_random_uuid()::text, 'BATTERY', v_battery.id, 'RETURN', 'SOLD', v_location, 'Returned from sale', auth.uid(), now());
        insert into public.lifecycle_events(entity_type, entity_id, from_status, to_status, reason, recorded_by)
        values ('BATTERY', v_battery.id, 'SOLD', 'IN_STOCK', 'Returned to ' || v_location || ' warehouse', auth.uid());
        perform public.record_genealogy_event('BATTERY', v_battery.id, 'RETURNED_TO_WAREHOUSE', null, null, jsonb_build_object('location', v_location));
        insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
        values ('BATTERY', v_battery.id, 'RETURN_TO_WAREHOUSE', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Returned to ' || v_location || ' warehouse');
        return jsonb_build_object('success', true, 'entityType', 'BATTERY', 'entityId', v_battery.id, 'location', v_location, 'status', 'WAREHOUSE');
    elsif v_entity_type <> 'RACK' then
        raise exception 'Unsupported sold entity type %', p_entity_type;
    else
        null;
    end if;

    if v_entity_type = 'RACK' then
    select * into v_rack
    from public.racks
    where id = trim(p_entity_id)
    for update;
    if not found then raise exception 'Rack % not found', p_entity_id; end if;
    if v_rack.status <> 'SOLD' then
        raise exception 'Rack % is not sold', v_rack.serial_number;
    end if;

    v_location := upper(trim(v_rack.location));
    if v_location not in ('KARACHI', 'LAHORE') then
        select upper(trim(wm.to_location)) into v_location
        from public.warehouse_movements wm
        where wm.entity_type = 'RACK'
          and wm.entity_id in (v_rack.id, v_rack.serial_number, v_rack.qr_code)
          and wm.movement_type <> 'DISPATCH'
          and upper(trim(wm.to_location)) in ('KARACHI', 'LAHORE')
        order by wm.moved_at desc
        limit 1;
    end if;
    if v_location is null or v_location not in ('KARACHI', 'LAHORE') then
        select upper(trim(wm.to_location)) into v_location
        from public.warehouse_movements wm
        join public.rack_packs rp on rp.rack_id = v_rack.id
        join public.batteries b on b.id = rp.battery_id
        where wm.entity_type = 'BATTERY'
          and wm.entity_id in (b.id, b.serial_number)
          and wm.movement_type <> 'DISPATCH'
          and upper(trim(wm.to_location)) in ('KARACHI', 'LAHORE')
        order by wm.moved_at desc
        limit 1;
    end if;
    if v_location is null or v_location not in ('KARACHI', 'LAHORE') then
        raise exception 'No previous Karachi or Lahore warehouse found for rack %', v_rack.serial_number;
    end if;

    update public.racks
    set status = 'IN_STOCK', location = v_location, updated_at = now()
    where id = v_rack.id;
    update public.batteries
    set status = 'WAREHOUSE', current_step = 'WAREHOUSE', lifecycle_status = 'IN_RACK', updated_at = now()
    where id in (select battery_id from public.rack_packs where rack_id = v_rack.id);
    update public.modules
    set lifecycle_status = 'IN_RACK', updated_at = now()
    where battery_id in (select battery_id from public.rack_packs where rack_id = v_rack.id);
    update public.cells c
    set lifecycle_status = 'IN_RACK', updated_at = now()
    where c.reserved_for_battery_id in (select battery_id from public.rack_packs where rack_id = v_rack.id)
       or exists (
           select 1 from public.module_cells mc
           join public.modules m on m.id = mc.module_id
           where mc.cell_id = c.id
             and m.battery_id in (select battery_id from public.rack_packs where rack_id = v_rack.id)
       );
    delete from public.sale_history where entity_type = 'RACK' and entity_id = v_rack.id;
    insert into public.warehouse_movements
        (id, entity_type, entity_id, movement_type, from_location, to_location, reference, moved_by, moved_at)
    values
        ('mov-' || gen_random_uuid()::text, 'RACK', v_rack.id, 'RETURN', 'SOLD', v_location, 'Returned from sale', auth.uid(), now());
    insert into public.lifecycle_events(entity_type, entity_id, from_status, to_status, reason, recorded_by)
    values ('RACK', v_rack.id, 'SOLD', 'IN_STOCK', 'Returned to ' || v_location || ' warehouse', auth.uid());
    perform public.record_genealogy_event('RACK', v_rack.id, 'RETURNED_TO_WAREHOUSE', null, null, jsonb_build_object('location', v_location));
    insert into public.audit_logs (entity_type, entity_id, action, actor, result, details)
    values ('RACK', v_rack.id, 'RETURN_TO_WAREHOUSE', coalesce(auth.uid()::text, 'SYSTEM'), 'SUCCESS', 'Returned to ' || v_location || ' warehouse');

    return jsonb_build_object('success', true, 'entityType', 'RACK', 'entityId', v_rack.id, 'location', v_location, 'status', 'IN_STOCK');
    end if;
end;
$$;

grant execute on function public.return_sold_entity_to_warehouse_transaction(text, text) to authenticated;
