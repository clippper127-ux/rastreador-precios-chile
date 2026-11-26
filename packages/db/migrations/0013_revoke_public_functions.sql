-- La función del disparador de nuevos usuarios no debe poder llamarse desde la API pública.
-- (El disparador sigue funcionando: corre con los permisos de su dueño.)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
-- Por si acaso: el servicio de autenticación de Supabase sí puede ejecutarla.
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
