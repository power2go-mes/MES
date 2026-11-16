-- Keep the date prefix in module serials, but continue the numeric suffix
-- globally across all existing P2G-MOD-DDMM-XXXXX serials.
-- This migration replaces only the two module-creation functions; it does not
-- change tables or rewrite existing module serials.
do $migration$
declare
    v_standalone_definition text;
    v_order_definition text;
    v_old text;
    v_new text;
begin
    select pg_get_functiondef(
        'public.create_standalone_module_transaction(text,text[])'::regprocedure
    ) into v_standalone_definition;

    v_old := 'where serial_number like v_module_prefix || ''-%'';';
    v_new := 'where serial_number ~ ''^P2G-MOD-[0-9]{4}-[0-9]+$'';';
    if position(v_old in v_standalone_definition) = 0 then
        raise exception 'Could not locate standalone module serial lookup; no function changed';
    end if;

    select pg_get_functiondef(
        'public.create_production_order_transaction(text,integer,text,text)'::regprocedure
    ) into v_order_definition;

    v_old := 'where serial_number like ''P2G-MOD-'' || to_char(current_date, ''DDMM'') || ''-%'';';
    v_new := 'where serial_number ~ ''^P2G-MOD-[0-9]{4}-[0-9]+$'';';
    if position(v_old in v_order_definition) = 0 then
        raise exception 'Could not locate production-order module serial lookup; no function changed';
    end if;

    execute replace(
        v_standalone_definition,
        'where serial_number like v_module_prefix || ''-%'';',
        'where serial_number ~ ''^P2G-MOD-[0-9]{4}-[0-9]+$'';'
    );
    execute replace(
        v_order_definition,
        'where serial_number like ''P2G-MOD-'' || to_char(current_date, ''DDMM'') || ''-%'';',
        'where serial_number ~ ''^P2G-MOD-[0-9]{4}-[0-9]+$'';'
    );
end;
$migration$;
