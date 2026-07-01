import type {
  Consultation,
  ConsultationDetail,
  ConsultationStatus,
  CreateConsultationResponse,
  CreateMessageResponse,
} from '@aimani-gs/contracts';

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

export async function fetchConsultationDetail(id: string): Promise<ConsultationDetail> {
  const response = await fetch(`/api/v1/consultations/${encodeURIComponent(id)}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });

  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as ConsultationDetail;
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

export async function createMessage(consultationId: string, body: string): Promise<CreateMessageResponse> {
  const response = await fetch(`/api/v1/consultations/${encodeURIComponent(consultationId)}/messages`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) throw new Error(await parseError(response));
  return (await response.json()) as CreateMessageResponse;
}

export async function updateConsultationStatus(id: string, status: ConsultationStatus): Promise<void> {
  const response = await fetch(`/api/v1/consultations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) throw new Error(await parseError(response));
  await response.body?.cancel().catch(() => undefined);
}
