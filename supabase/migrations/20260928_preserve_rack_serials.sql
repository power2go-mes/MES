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
end $$;
