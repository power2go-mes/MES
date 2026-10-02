INSERT INTO public.roles (id, name, description, status)
VALUES ('role-inventory-manager', 'Inventory Manager', 'Read-only Inventory Manager Monitoring, Inventory, and Traceability access', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;
