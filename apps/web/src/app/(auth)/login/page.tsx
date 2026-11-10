'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sparkles, Shield, AlertCircle } from 'lucide-react';
import { Button, Input, Card, CardHeader, CardTitle, CardDescription, CardContent } from '@crelune/ui';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      router.push(callbackUrl);
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="shadow-md border-[#E8E5ED]">
      <CardHeader>
        <CardTitle>Owner Sign In</CardTitle>
        <CardDescription>
          Enter your credentials to access your creative workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 flex items-center gap-2 p-3 text-xs text-[#991B1B] bg-[#FEF2F2] border border-[#FECACA] rounded-lg">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#DC2626]" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Owner Email Address"
            type="email"
            required
            autoComplete="email"
            placeholder="owner@crelune.app"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
          />

          <Input
            label="Master Password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
          />

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full mt-2"
            isLoading={isLoading}
          >
            Sign In to Workspace
          </Button>
        </form>

        <div className="mt-6 pt-4 border-t border-[#E8E5ED] text-center">
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#77727F]">
            <Shield className="w-3.5 h-3.5 text-[#6541A5]" />
            <span>Single-Owner Operations Environment</span>
          </div>
          <p className="mt-1 text-[10px] text-[#9B96A4]">
            Public registration is disabled. Accounts are managed via the authorized local CLI.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#F8F7FA] flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        {/* Brand Mark */}
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#6541A5] text-white shadow-md mb-4">
          <Sparkles className="h-6 w-6 text-white" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-[#24212B]">
          CRELUNE
        </h2>
        <p className="mt-1 text-xs text-[#77727F]">
          Create. Organise. Bring ideas to life.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <Suspense fallback={<div className="p-8 text-center text-xs text-[#77727F]">Loading...</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
