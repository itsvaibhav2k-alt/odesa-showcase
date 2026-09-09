'use client';

import { createBrowserClient } from '@/lib/supabase/client';
import { useEffect, useState, useCallback } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  organizationId: string;
  organizationName: string;
  role: string;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const supabase = createBrowserClient();
      const { data: { user: authUser } } = await supabase.auth.getUser();

      if (!authUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      const { data: dbUser } = await supabase
        .from('users')
        .select('id, email, full_name, avatar_url, organization_id, role')
        .eq('id', authUser.id)
        .single<{
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          organization_id: string;
          role: string;
        }>();

      if (!dbUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      const { data: organization } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('id', dbUser.organization_id)
        .single<{ id: string; name: string }>();

      setUser({
        id: dbUser.id,
        email: dbUser.email,
        fullName: dbUser.full_name || authUser.email || 'User',
        avatarUrl: dbUser.avatar_url,
        organizationId: dbUser.organization_id,
        organizationName: organization?.name || 'My organization',
        role: dbUser.role,
      });
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  return { user, loading, refetch: fetchUser };
}
