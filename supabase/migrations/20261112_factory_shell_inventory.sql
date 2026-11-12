-- Factory-wide physical stock for rack and cabinet shell templates.
-- Existing tables and columns are unchanged; stock is stored in dedicated tables.

create table if not exists public.rack_shell_inventory (
    shell_template_id text primary key references public.rack_shell_templates(id) on delete cascade,
    quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users(id)
);

create table if not exists public.rack_shell_inventory_movements (
    id uuid primary key default gen_random_uuid(),
    shell_template_id text not null references public.rack_shell_templates(id) on delete cascade,
    movement_type text not null check (movement_type in ('INITIAL', 'ADJUSTMENT', 'ASSEMBLY_CONSUMPTION', 'ASSEMBLY_RETURN')),
    quantity_change integer not null check (quantity_change <> 0),
    quantity_after integer not null check (quantity_after >= 0),
    reference_type text,
    reference_id text,
    reason text not null,
    recorded_by uuid references auth.users(id),
    recorded_at timestamptz not null default now()
);

create index if not exists idx_rack_shell_inventory_movements_template
    on public.rack_shell_inventory_movements(shell_template_id, recorded_at desc);

alter table public.rack_shell_inventory enable row level security;
alter table public.rack_shell_inventory_movements enable row level security;

drop policy if exists "Read rack shell inventory" on public.rack_shell_inventory;
create policy "Read rack shell inventory" on public.rack_shell_inventory
for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));

drop policy if exists "Read rack shell inventory movements" on public.rack_shell_inventory_movements;
create policy "Read rack shell inventory movements" on public.rack_shell_inventory_movements
for select using (public.has_permission('READ_MES') or public.has_permission('ALL'));

insert into public.rack_shell_inventory (shell_template_id, quantity_on_hand)
select id, 0 from public.rack_shell_templates
on conflict (shell_template_id) do nothing;

create or replace function public.initialize_rack_shell_inventory()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    insert into public.rack_shell_inventory (shell_template_id, quantity_on_hand, updated_by)
    values (new.id, 0, auth.uid())
    on conflict (shell_template_id) do nothing;
    return new;
end;
$$;

drop trigger if exists trg_initialize_rack_shell_inventory on public.rack_shell_templates;
create trigger trg_initialize_rack_shell_inventory
after insert on public.rack_shell_templates
for each row execute function public.initialize_rack_shell_inventory();

create or replace function public.set_rack_shell_inventory_quantity(
    p_shell_template_id text,
    p_quantity integer,
    p_reason text default 'Manual stock adjustment'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_previous integer;
    v_change integer;
begin
    perform public.require_permission('MANAGE_PRODUCTION');
    if p_quantity is null or p_quantity < 0 then
        raise exception 'Shell quantity must be zero or more';
    end if;
    if nullif(trim(p_reason), '') is null then
        raise exception 'Shell stock adjustment reason is required';
    end if;
    if not exists (select 1 from public.rack_shell_templates where id = p_shell_template_id) then
        raise exception 'Shell template % not found', p_shell_template_id;
    end if;

    insert into public.rack_shell_inventory (shell_template_id, quantity_on_hand, updated_by)
    values (p_shell_template_id, 0, auth.uid())
    on conflict (shell_template_id) do nothing;

    select quantity_on_hand into v_previous
    from public.rack_shell_inventory
    where shell_template_id = p_shell_template_id
    for update;

    v_change := p_quantity - v_previous;
    update public.rack_shell_inventory
    set quantity_on_hand = p_quantity,
        updated_at = now(),
        updated_by = auth.uid()
    where shell_template_id = p_shell_template_id;

    if v_change <> 0 then
        insert into public.rack_shell_inventory_movements (
            shell_template_id, movement_type, quantity_change, quantity_after,
            reference_type, reference_id, reason, recorded_by
        ) values (
            p_shell_template_id,
            case when exists (
                select 1 from public.rack_shell_inventory_movements
                where shell_template_id = p_shell_template_id
            ) then 'ADJUSTMENT' else 'INITIAL' end,
            v_change, p_quantity, 'SHELL_TEMPLATE', p_shell_template_id, trim(p_reason), auth.uid()
        );
    end if;

    return jsonb_build_object(
        'shellTemplateId', p_shell_template_id,
        'quantityAvailable', p_quantity,
        'quantityChange', v_change
    );
end;
$$;

revoke all on function public.set_rack_shell_inventory_quantity(text, integer, text) from public;
revoke all on function public.set_rack_shell_inventory_quantity(text, integer, text) from anon;
grant execute on function public.set_rack_shell_inventory_quantity(text, integer, text) to authenticated;

create or replace function public.consume_rack_shell_inventory()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_quantity integer;
begin
    if new.shell_template_id is null then
        raise exception 'A shell template is required for rack or cabinet assembly';
    end if;

    select quantity_on_hand into v_quantity
    from public.rack_shell_inventory
    where shell_template_id = new.shell_template_id
    for update;

    if not found or v_quantity < 1 then
        raise exception 'Selected rack/cabinet shell is out of stock';
    end if;

    update public.rack_shell_inventory
    set quantity_on_hand = quantity_on_hand - 1,
        updated_at = now(),
        updated_by = auth.uid()
    where shell_template_id = new.shell_template_id;

    insert into public.rack_shell_inventory_movements (
        shell_template_id, movement_type, quantity_change, quantity_after,
        reference_type, reference_id, reason, recorded_by
    ) values (
        new.shell_template_id, 'ASSEMBLY_CONSUMPTION', -1, v_quantity - 1,
        'RACK', new.id, 'Shell consumed by successful rack/cabinet assembly', auth.uid()
    );

    return new;
end;
$$;

drop trigger if exists trg_consume_rack_shell_inventory on public.racks;
create trigger trg_consume_rack_shell_inventory
before insert on public.racks
for each row execute function public.consume_rack_shell_inventory();

create or replace function public.return_deleted_rack_shell_inventory()
returns trigger language plpgsql security definer set search_path = public as $$
declare
    v_quantity integer;
begin
    if old.shell_template_id is null or old.status = 'SOLD' then
        return old;
    end if;

    insert into public.rack_shell_inventory (shell_template_id, quantity_on_hand, updated_by)
    values (old.shell_template_id, 1, auth.uid())
    on conflict (shell_template_id) do update
    set quantity_on_hand = public.rack_shell_inventory.quantity_on_hand + 1,
        updated_at = now(),
        updated_by = auth.uid()
    returning quantity_on_hand into v_quantity;

    insert into public.rack_shell_inventory_movements (
        shell_template_id, movement_type, quantity_change, quantity_after,
        reference_type, reference_id, reason, recorded_by
    ) values (
        old.shell_template_id, 'ASSEMBLY_RETURN', 1, v_quantity,
        'RACK', old.id, 'Shell returned after rack/cabinet deletion', auth.uid()
    );

    return old;
end;
$$;

drop trigger if exists trg_return_deleted_rack_shell_inventory on public.racks;
create trigger trg_return_deleted_rack_shell_inventory
after delete on public.racks
for each row execute function public.return_deleted_rack_shell_inventory();

