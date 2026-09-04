-- CEO Monitoring: keep dashboard values derived from the normalized MES tables.
create or replace function public.get_dashboard_summary()
returns jsonb
language sql
security definer
set search_path = public
as $$
with cell_counts as (
    select
        count(*)::int as total,
        count(*) filter (where status = 'AVAILABLE')::int as available,
        count(*) filter (where status = 'RESERVED')::int as reserved,
        count(*) filter (where status in ('IN_PROCESS', 'VALIDATING', 'TESTING', 'SCANNED', 'PASSED'))::int as in_process,
        count(*) filter (where status = 'ASSEMBLED')::int as assembled,
        count(*) filter (where status = 'QUARANTINED')::int as quarantined,
        count(*) filter (where status in ('IMPORTED', 'ACKNOWLEDGED', 'OCV_TESTED', 'GRADED'))::int as floor_stock
    from public.cells
),
battery_counts as (
    select
        count(*) filter (where status in ('FINISHED', 'RELEASED', 'DISPATCHED'))::int as finished,
        count(*) filter (where status in ('CREATED', 'ASSEMBLY', 'TESTING', 'QC', 'IN_PROCESS'))::int as in_process
    from public.batteries
),
order_counts as (
    select
        count(*)::int as total,
        count(*) filter (where status = 'IN_PROCESS')::int as in_process,
        count(*) filter (where status = 'COMPLETED')::int as completed,
        count(*) filter (where status = 'PLANNED')::int as planned
    from public.production_orders
),
machine_counts as (
    select
        count(*)::int as total,
        count(*) filter (where status in ('ONLINE', 'BUSY'))::int as online
    from public.machine_configurations
),
summary as (
    select cell_counts.*, battery_counts.finished, battery_counts.in_process as batteries_in_process,
           order_counts.total as orders_total, order_counts.in_process as orders_in_process,
           order_counts.completed as orders_completed, order_counts.planned as orders_planned,
           machine_counts.total as machines_total, machine_counts.online as machines_online
    from cell_counts, battery_counts, order_counts, machine_counts
)
select jsonb_build_object(
    'inventory', jsonb_build_object(
        'totalCells', total,
        'availableCells', available,
        'usedCells', total - available,
        'reservedCells', reserved,
        'inProcessCells', in_process,
        'assembledCells', assembled,
        'quarantinedCells', quarantined,
        'finishedBatteries', finished,
        'inProcessBatteries', batteries_in_process
    ),
    'quality', jsonb_build_object(
        'firstPassYieldPercent', coalesce(round((finished::numeric / nullif((finished + quarantined), 0)) * 100, 1), 0),
        'quarantinedCount', (select count(*)::int from public.quarantine_records where status = 'OPEN')
    ),
    'orders', jsonb_build_object(
        'total', orders_total,
        'inProcess', orders_in_process,
        'completed', orders_completed,
        'planned', orders_planned
    ),
    'kpis', jsonb_build_object(
        'totalCellsInInventory', total,
        'availableCells', available,
        'usedCells', total - available,
        'reservedCells', reserved,
        'inProcessCells', in_process,
        'assembledCells', assembled,
        'quarantinedCells', quarantined,
        'totalBatteriesCompleted', finished,
        'batteriesInProduction', batteries_in_process,
        'activeOrders', orders_in_process,
        'firstPassYield', coalesce(round((finished::numeric / nullif((finished + quarantined), 0)) * 100, 1), 0),
        'onlineMachines', machines_online,
        'totalMachines', machines_total
    ),
    'machines', coalesce((select jsonb_agg(to_jsonb(m) - 'created_at' - 'updated_at' order by m.name) from public.machine_configurations m), '[]'::jsonb),
    'cellBuckets', jsonb_build_array(
        jsonb_build_object('label', 'In Stock', 'value', available),
        jsonb_build_object('label', 'Floor Stock', 'value', floor_stock),
        jsonb_build_object('label', 'In Module', 'value', assembled),
        jsonb_build_object('label', 'In Pack', 'value', in_process),
        jsonb_build_object('label', 'Sold', 'value', finished),
        jsonb_build_object('label', 'Scrap', 'value', quarantined)
    ),
    'recentBatteries', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'serialNumber', b.serial_number, 'productName', p.name,
        'currentStep', b.current_step, 'progressPercent', b.progress_percent, 'status', b.status
    ) order by b.created_at desc) from public.batteries b join public.product_templates p on p.id = b.product_id limit 20), '[]'::jsonb),
    'recentOrders', coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc) from public.production_orders o limit 20), '[]'::jsonb),
    'recentAuditLogs', coalesce((select jsonb_agg(to_jsonb(a) order by a.timestamp desc) from public.audit_logs a limit 20), '[]'::jsonb),
    'quarantineOpenCount', (select count(*)::int from public.quarantine_records where status = 'OPEN')
)
from summary;
$$;

grant execute on function public.get_dashboard_summary() to anon, authenticated;
