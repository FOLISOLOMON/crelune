'use client';

import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  KeyRound,
  Laptop,
  Plus,
  ShieldOff,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@crelune/ui';
import type { CreativeAgentSummary } from '@crelune/shared';
import { formatDateTimeDisplay } from '@/lib/templates/template-ui-utils';

export interface CreativeAgentsCardProps {
  initialAgents: CreativeAgentSummary[];
}

export function CreativeAgentsCard({ initialAgents }: CreativeAgentsCardProps) {
  const [agents, setAgents] = useState<CreativeAgentSummary[]>(initialAgents);
  const [name, setName] = useState('');
  const [machineLabel, setMachineLabel] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRegistering) return;

    setError(null);
    setStatusMessage(null);
    setOneTimeToken(null);
    setCopied(false);

    if (name.trim().length < 2 || machineLabel.trim().length < 2) {
      setError('Enter both an agent name and machine label (minimum 2 characters).');
      return;
    }

    setIsRegistering(true);
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          machineLabel: machineLabel.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        agent?: CreativeAgentSummary;
        oneTimeToken?: string;
        error?: string;
      };
      if (!res.ok || !body.agent || !body.oneTimeToken) {
        setError(body.error ?? 'Unable to register Windows Creative Agent.');
        return;
      }

      setAgents((prev) => [body.agent!, ...prev]);
      setOneTimeToken(body.oneTimeToken);
      setName('');
      setMachineLabel('');
      setStatusMessage(
        'Windows Creative Agent registered. Copy the one-time pairing token below — it will not be displayed again.'
      );
    } catch {
      setError('Unable to reach server while registering creative agent.');
    } finally {
      setIsRegistering(false);
    }
  };

  const handleRevoke = async (agentId: string) => {
    if (revokingId) return;
    setRevokingId(agentId);
    setError(null);
    setStatusMessage(null);

    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/revoke`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'Revoked by workspace owner from Settings.',
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        agent?: CreativeAgentSummary;
        error?: string;
      };
      if (!res.ok || !body.agent) {
        setError(body.error ?? 'Unable to revoke creative agent.');
        return;
      }
      setAgents((prev) =>
        prev.map((item) => (item.id === agentId ? body.agent! : item))
      );
      setStatusMessage('Creative agent credentials revoked immediately.');
    } catch {
      setError('Unable to reach server while revoking creative agent.');
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopyToken = async () => {
    if (!oneTimeToken || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(oneTimeToken);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Laptop className="w-4 h-4 text-[#6541A5]" />
          <CardTitle>Windows Creative Agents</CardTitle>
        </div>
        <CardDescription>
          Register local Windows workstations for outbound authenticated creative job preparation. Tokens are stored server-side as SHA-256 hashes only and encrypted locally via Windows DPAPI.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {statusMessage && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-3.5 py-2.5 text-xs font-medium text-[#166534]"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#16A34A]" />
            <span>{statusMessage}</span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#991B1B]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC2626]" />
            <span>{error}</span>
          </div>
        )}

        {oneTimeToken && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2.5 text-xs text-amber-950">
            <div className="flex items-center gap-2 font-semibold">
              <KeyRound className="h-4 w-4 text-amber-700" />
              <span>One-Time Agent Pairing Token (Copy Now)</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              Run <code className="font-mono bg-white px-1 py-0.5 rounded">crelune-agent pair --api-url &lt;url&gt;</code> on your Windows workstation and paste this token. For your security, this token is never retrievable again after you leave or dismiss this notice.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 break-all rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-[#24212B]">
                {oneTimeToken}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyToken}
              >
                <Copy className="h-3.5 w-3.5 mr-1" />
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOneTimeToken(null)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        <form
          onSubmit={handleRegister}
          className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end rounded-xl border border-[#E8E5ED] bg-[#F8F7FA]/60 p-4"
        >
          <Input
            label="Agent Name"
            placeholder="e.g. Studio Desk Windows PC"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isRegistering}
          />
          <Input
            label="Machine Label"
            placeholder="e.g. CRELUNE-WIN11-01"
            value={machineLabel}
            onChange={(e) => setMachineLabel(e.target.value)}
            disabled={isRegistering}
          />
          <Button type="submit" size="sm" isLoading={isRegistering}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Register Agent
          </Button>
        </form>

        {agents.length === 0 ? (
          <p className="text-xs text-[#77727F]">
            No Windows Creative Agents registered yet. You can continue using standalone Manual Preparation on any design job or register your Windows workstation above.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {agents.map((agent) => (
              <li
                key={agent.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E8E5ED] bg-white px-4 py-3 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[#24212B]">
                      {agent.name}
                    </span>
                    <Badge
                      variant={agent.status === 'ACTIVE' ? 'success' : 'error'}
                      size="sm"
                    >
                      {agent.status}
                    </Badge>
                    <code className="font-mono text-[11px] text-[#77727F]">
                      {agent.tokenPrefix}…
                    </code>
                  </div>
                  <p className="text-[11px] text-[#77727F]">
                    Machine: <strong className="text-[#24212B]">{agent.machineLabel}</strong> ·
                    Agent v{agent.agentVersion ?? 'unreported'} · Affinity{' '}
                    {agent.affinityVersion ?? 'not detected yet'} · Last heartbeat:{' '}
                    {agent.lastHeartbeatAt
                      ? formatDateTimeDisplay(agent.lastHeartbeatAt)
                      : 'Never'}
                  </p>
                </div>
                {agent.status === 'ACTIVE' && (
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    isLoading={revokingId === agent.id}
                    onClick={() => handleRevoke(agent.id)}
                  >
                    <ShieldOff className="h-3.5 w-3.5 mr-1" />
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
