begin;

-- Renumber existing modules globally while preserving each module's DDMM prefix.
create temporary table module_serial_renumber_map on commit drop as
select
    id,
    serial_number as old_serial_number,
    concat(
        substring(serial_number from '^(P2G-MOD-[0-9]{4})'),
        '-',
        lpad(row_number() over (order by created_at, id)::text, 5, '0')
    ) as new_serial_number
from public.modules
where serial_number ~ '^P2G-MOD-[0-9]{4}-[0-9]+$';

-- Clear the unique values first so rows can be reassigned without collisions.
update public.modules as modules
set serial_number = concat('P2G-MOD-RENUMBER-', modules.id)
from module_serial_renumber_map as renumber
where modules.id = renumber.id;

update public.modules as modules
set
    serial_number = renumber.new_serial_number,
    updated_at = now()
from module_serial_renumber_map as renumber
where modules.id = renumber.id;

commit;
