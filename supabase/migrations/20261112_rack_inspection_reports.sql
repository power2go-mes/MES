-- Rack/cabinet factory inspection answers and attached PDF data.

create table if not exists public.rack_inspection_reports (
    id uuid primary key default gen_random_uuid(),
    rack_id text not null unique references public.racks(id) on delete cascade,
    rack_serial text not null,
    pack_socs jsonb not null default '{}'::jsonb,
    pack_voltages jsonb not null default '{}'::jsonb,
    pack_currents jsonb not null default '{}'::jsonb,
    cycle1_charged_kwh numeric,
    cycle1_discharged_kwh numeric,
    cycle2_charged_kwh numeric,
    cycle2_discharged_kwh numeric,
    solis_bms_comm text not null default 'Stable',
    pdf_file_name text,
    pdf_file_size text,
    pdf_data_url text,
    created_at timestamptz not null default now(),
    created_by uuid references auth.users(id)
);

alter table public.rack_inspection_reports
    add column if not exists rack_id text references public.racks(id) on delete cascade,
    add column if not exists rack_serial text,
    add column if not exists pack_socs jsonb not null default '{}'::jsonb,
    add column if not exists pack_voltages jsonb not null default '{}'::jsonb,
    add column if not exists pack_currents jsonb not null default '{}'::jsonb,
    add column if not exists cycle1_charged_kwh numeric,
    add column if not exists cycle1_discharged_kwh numeric,
    add column if not exists cycle2_charged_kwh numeric,
    add column if not exists cycle2_discharged_kwh numeric,
    add column if not exists solis_bms_comm text not null default 'Stable',
    add column if not exists pdf_file_name text,
    add column if not exists pdf_file_size text,
    add column if not exists pdf_data_url text,
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists created_by uuid references auth.users(id);

create unique index if not exists rack_inspection_reports_rack_unique
    on public.rack_inspection_reports(rack_id);

alter table public.rack_inspection_reports enable row level security;

drop policy if exists "Read rack inspection reports" on public.rack_inspection_reports;
create policy "Read rack inspection reports" on public.rack_inspection_reports
for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));

create or replace function public.assemble_rack_with_inspection(
    p_template_code text,
    p_battery_ids text[],
    p_location text default null,
    p_shell_template_id text default null,
    p_inspection_data jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_rack jsonb;
    v_rack_id text;
    v_rack_serial text;
begin
    perform public.require_permission('MANAGE_PRODUCTION');

    v_rack := public.assemble_rack_transaction(
        p_template_code,
        p_battery_ids,
        p_location,
        p_shell_template_id
    );
    v_rack_id := coalesce(v_rack->>'rackId', v_rack->>'rack_id', v_rack->>'id');
    v_rack_serial := coalesce(v_rack->>'serialNumber', v_rack->>'serial_number', '');

    if nullif(v_rack_id, '') is null then
        raise exception 'Rack assembly did not return a rack identifier';
    end if;

    insert into public.rack_inspection_reports (
        rack_id,
        rack_serial,
        pack_socs,
        pack_voltages,
        pack_currents,
        cycle1_charged_kwh,
        cycle1_discharged_kwh,
        cycle2_charged_kwh,
        cycle2_discharged_kwh,
        solis_bms_comm,
        pdf_file_name,
        pdf_file_size,
        pdf_data_url,
        created_by
    ) values (
        v_rack_id,
        v_rack_serial,
        coalesce(p_inspection_data->'packSocs', '{}'::jsonb),
        coalesce(p_inspection_data->'packVoltages', '{}'::jsonb),
        coalesce(p_inspection_data->'packCurrents', '{}'::jsonb),
        nullif(p_inspection_data->>'cycle1ChargedKwh', '')::numeric,
        nullif(p_inspection_data->>'cycle1DischargedKwh', '')::numeric,
        nullif(p_inspection_data->>'cycle2ChargedKwh', '')::numeric,
        nullif(p_inspection_data->>'cycle2DischargedKwh', '')::numeric,
        coalesce(nullif(p_inspection_data->>'solisBmsComm', ''), 'Stable'),
        nullif(p_inspection_data->>'pdfFileName', ''),
        nullif(p_inspection_data->>'pdfFileSize', ''),
        nullif(p_inspection_data->>'pdfDataUrl', ''),
        auth.uid()
    );

    return v_rack || jsonb_build_object('id', v_rack_id);
end;
$$;

revoke all on function public.assemble_rack_with_inspection(text, text[], text, text, jsonb) from public;
revoke all on function public.assemble_rack_with_inspection(text, text[], text, text, jsonb) from anon;
grant execute on function public.assemble_rack_with_inspection(text, text[], text, text, jsonb) to authenticated;

