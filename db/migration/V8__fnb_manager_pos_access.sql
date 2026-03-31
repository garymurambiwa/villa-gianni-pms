-- Grant POS Settings/Management access to existing FNB Manager (posmanager) users
-- Adds 'admin_change_global_config' permission if not already present
UPDATE public.app_users
SET permissions = array_append(permissions, 'admin_change_global_config'),
    updated_at = NOW()
WHERE role = 'posmanager'
  AND active = true
  AND NOT (permissions @> ARRAY['admin_change_global_config']);
