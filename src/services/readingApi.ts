import { Platform } from 'react-native';

import { PalmReading, SelectedPalm } from '../types';

type ApiErrorShape = {
  error?: { message?: string };
  message?: string;
};

function endpoint() {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '');

  if (!baseUrl) {
    if (Platform.OS === 'web') return '/api/readings';
    throw new Error(
      'Set EXPO_PUBLIC_API_URL to your backend address before creating a reading.',
    );
  }

  return `${baseUrl}/api/readings`;
}

function reportEndpoint(readingId: string) {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '');
  if (!baseUrl && Platform.OS !== 'web') {
    throw new Error('Set EXPO_PUBLIC_API_URL to your backend address before saving a report.');
  }
  return `${baseUrl || ''}/api/readings/${encodeURIComponent(readingId)}/report`;
}

async function appendPalmImage(form: FormData, palm: SelectedPalm) {
  const filename = palm.name || `palm-${Date.now()}.jpg`;
  const mimeType = palm.mimeType || 'image/jpeg';

  if (Platform.OS === 'web') {
    // Browser FormData does not understand React Native's `{ uri, name, type }`
    // file descriptor. Convert the camera/gallery URI into a real Blob first.
    let imageBlob: Blob;
    try {
      const imageResponse = await fetch(palm.uri);
      imageBlob = await imageResponse.blob();
    } catch {
      throw new Error('We could not prepare this palm photo for upload. Please choose it again.');
    }

    if (!imageBlob.size) {
      throw new Error('This palm photo is empty. Please choose or take it again.');
    }

    form.append('palm', imageBlob.type ? imageBlob : new Blob([imageBlob], { type: mimeType }), filename);
    return;
  }

  form.append(
    'palm',
    {
      uri: palm.uri,
      name: filename,
      type: mimeType,
    } as unknown as Blob,
  );
}

export async function createReading(name: string, palm: SelectedPalm): Promise<PalmReading> {
  const form = new FormData();
  form.append('name', name.trim());
  await appendPalmImage(form, palm);

  const url = endpoint();
  let response: Response;
  try {
    // Do not set Content-Type here: React Native supplies the multipart boundary.
    response = await fetch(url, { method: 'POST', body: form });
  } catch {
    throw new Error('We could not reach the reading service. Check your connection and try again.');
  }

  let payload: ({ ok?: boolean; reading?: PalmReading } & ApiErrorShape) | undefined;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The reading service sent an unexpected response. Please try again.');
  }

  if (!response.ok || !payload?.ok || !payload.reading) {
    throw new Error(payload?.error?.message || payload?.message || 'Unable to read this palm right now.');
  }

  return payload.reading;
}

export async function uploadReportImage(readingId: string, report: SelectedPalm): Promise<{ reportImageUrl: string; reportImagePublicId: string }> {
  const form = new FormData();
  const filename = report.name || `palm-report-${Date.now()}.jpg`;
  const mimeType = report.mimeType || 'image/jpeg';
  if (Platform.OS === 'web') {
    let imageBlob: Blob;
    try {
      imageBlob = await (await fetch(report.uri)).blob();
    } catch {
      throw new Error('We could not prepare your report image for saving.');
    }
    form.append('report', imageBlob.type ? imageBlob : new Blob([imageBlob], { type: mimeType }), filename);
  } else {
    form.append(
      'report',
      {
        uri: report.uri,
        name: filename,
        type: mimeType,
      } as unknown as Blob,
    );
  }

  let response: Response;
  try {
    response = await fetch(reportEndpoint(readingId), { method: 'POST', body: form });
  } catch {
    throw new Error('We could not reach the service to save your report.');
  }

  let payload: ({ ok?: boolean; report?: { imageUrl?: string; imagePublicId?: string } } & ApiErrorShape) | undefined;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The report service sent an unexpected response.');
  }

  if (!response.ok || !payload?.ok || !payload.report?.imageUrl || !payload.report.imagePublicId) {
    throw new Error(payload?.error?.message || payload?.message || 'We could not save your report.');
  }

  return { reportImageUrl: payload.report.imageUrl, reportImagePublicId: payload.report.imagePublicId };
}
