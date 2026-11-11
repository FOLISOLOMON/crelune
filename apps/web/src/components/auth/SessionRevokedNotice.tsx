'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert, LogOut } from 'lucide-react';
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent } from '@crelune/ui';

export function SessionRevokedNotice() {
  const router = useRouter();
  const [isClearing, setIsClearing] = useState(false);

  const handleClearAndSignIn = async () => {
    setIsClearing(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors and proceed to login
    } finally {
      router.push('/login');
      router.refresh();
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F7FA] flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-[#FECACA] shadow-md">
        <CardHeader>
          <div className="flex items-center gap-2.5 text-[#DC2626] mb-1">
            <ShieldAlert className="w-5 h-5" />
            <CardTitle>Session Inactive or Revoked</CardTitle>
          </div>
          <CardDescription>
            Your workspace session is no longer active because the owner account was deactivated or all sessions were revoked.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-[#77727F]">
            For your security, access to CRELUNE operations has been halted. Clear this session to return to sign in.
          </p>
          <Button
            type="button"
            variant="primary"
            size="md"
            className="w-full"
            onClick={handleClearAndSignIn}
            isLoading={isClearing}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Clear Session & Return to Sign In
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
