INSERT INTO public.roles (id, name, description, status)
VALUES ('role-inventory-manager', 'Inventory Manager', 'Read-only Inventory Manager Monitoring, Inventory, and Traceability access', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
VALUES ('role-inventory-manager', 'READ_MES')
ON CONFLICT (role_id, permission_id) DO NOTHING;
