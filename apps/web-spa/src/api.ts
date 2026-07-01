import type { Consultation, CreateConsultationResponse } from '@aimani-gs/contracts';

async function parseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  return body?.error ?? body?.message ?? `request failed: ${response.status}`;
}

export async function fetchConsultations(): Promise<Consultation[]> {
  const response = await fetch('/api/v1/consultations', {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });

  if (response.status === 401) return [];
  if (!response.ok) throw new Error(await parseError(response));

  return (await response.json()) as Consultation[];
}

export async function createConsultation(body: string): Promise<CreateConsultationResponse> {
  const response = await fetch('/api/v1/consultations', {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title: body,
      body,
      visibility: 'private',
    }),
  });

  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as CreateConsultationResponse;
}
