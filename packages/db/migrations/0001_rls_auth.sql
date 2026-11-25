-- RLS, FKs hacia auth.users (Supabase) y creación automática del perfil.
-- La app y el worker usan conexión directa (rol postgres), que se salta RLS.
-- Esto es defensa en profundidad: la publishable/anon key es pública y sin RLS daría acceso a todo.

-- ─── FKs hacia auth.users ────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_auth_users_fk
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.watches ADD CONSTRAINT watches_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.alerts ADD CONSTRAINT alerts_user_id_auth_users_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE public.price_snapshots ADD CONSTRAINT price_snapshots_reported_by_auth_users_fk
  FOREIGN KEY (reported_by) REFERENCES auth.users(id) ON DELETE SET NULL;
--> statement-breakpoint

-- ─── Perfil automático al registrarse ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint

-- ─── RLS en todas las tablas ─────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.store_rate ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.extraction_strategies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.fetch_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.price_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.watches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.watch_listings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Sin políticas = sin acceso para anon/authenticated:
-- store_rate, extraction_strategies, fetch_runs (solo servidor).

-- ─── Lo personal: cada usuario ve y edita solo lo suyo ───────────────────────
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated USING ((select auth.uid()) = id);
--> statement-breakpoint
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated USING ((select auth.uid()) = id) WITH CHECK ((select auth.uid()) = id);
--> statement-breakpoint
CREATE POLICY watches_all_own ON public.watches
  FOR ALL TO authenticated USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
--> statement-breakpoint
CREATE POLICY watch_listings_all_own ON public.watch_listings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.watches w WHERE w.id = watch_id AND w.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.watches w WHERE w.id = watch_id AND w.user_id = (select auth.uid())));
--> statement-breakpoint
CREATE POLICY alerts_select_own ON public.alerts
  FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);
--> statement-breakpoint

-- ─── Catálogo compartido: lectura para usuarios con sesión, escritura solo servidor ─
CREATE POLICY stores_read ON public.stores FOR SELECT TO authenticated USING (true);
--> statement-breakpoint
CREATE POLICY products_read ON public.products FOR SELECT TO authenticated USING (true);
--> statement-breakpoint
CREATE POLICY listings_read ON public.listings FOR SELECT TO authenticated USING (true);
--> statement-breakpoint
CREATE POLICY price_snapshots_read ON public.price_snapshots FOR SELECT TO authenticated USING (true);
