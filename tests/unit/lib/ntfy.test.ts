import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/lib/server-env', () => ({
  getServerEnv: vi.fn(),
}));

import { getServerEnv } from '../../../src/lib/server-env';
import { publishNtfyNotification } from '../../../src/lib/ntfy';

const DEFAULT_NTFY_URL = 'https://ntfy.sh/hedge-order';

describe('publishNtfyNotification', () => {
  beforeEach(() => {
    vi.mocked(getServerEnv).mockReturnValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
        } as Response)
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(getServerEnv).mockReset();
  });

  it('does not call fetch when NTFY_DISABLE is 1', async () => {
    vi.mocked(getServerEnv).mockImplementation((key: string) =>
      key === 'NTFY_DISABLE' ? '1' : undefined
    );
    await publishNtfyNotification({ title: 'T', message: 'M' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not call fetch when NTFY_DISABLE is true (case insensitive)', async () => {
    vi.mocked(getServerEnv).mockImplementation((key: string) =>
      key === 'NTFY_DISABLE' ? 'TRUE' : undefined
    );
    await publishNtfyNotification({ title: 'T', message: 'M' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('POSTs to default topic URL with Title header and plain body', async () => {
    await publishNtfyNotification({ title: 'New order', message: 'Line1\nLine2' });
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe(DEFAULT_NTFY_URL);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('Line1\nLine2');
    const headers = init?.headers as Headers;
    expect(headers.get('Title')).toBe('New order');
    expect(headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(headers.get('Authorization')).toBeNull();
  });

  it('uses NTFY_TOPIC_URL when set', async () => {
    vi.mocked(getServerEnv).mockImplementation((key: string) =>
      key === 'NTFY_TOPIC_URL' ? 'https://ntfy.sh/my-custom-topic' : undefined
    );
    await publishNtfyNotification({ title: 'A', message: 'B' });
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe('https://ntfy.sh/my-custom-topic');
  });

  it('trims NTFY_TOPIC_URL whitespace', async () => {
    vi.mocked(getServerEnv).mockImplementation((key: string) =>
      key === 'NTFY_TOPIC_URL' ? '  https://ntfy.sh/topic  ' : undefined
    );
    await publishNtfyNotification({ title: 'A', message: 'B' });
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe('https://ntfy.sh/topic');
  });

  it('sends Bearer token when NTFY_ACCESS_TOKEN is set', async () => {
    vi.mocked(getServerEnv).mockImplementation((key: string) => {
      if (key === 'NTFY_ACCESS_TOKEN') return 'secret_token';
      return undefined;
    });
    await publishNtfyNotification({ title: 'A', message: 'B' });
    const init = vi.mocked(globalThis.fetch).mock.calls[0][1];
    const headers = init?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer secret_token');
  });

  it('truncates Title header to 250 characters', async () => {
    const long = 'x'.repeat(300);
    await publishNtfyNotification({ title: long, message: 'm' });
    const init = vi.mocked(globalThis.fetch).mock.calls[0][1];
    const headers = init?.headers as Headers;
    expect(headers.get('Title')?.length).toBe(250);
    expect(headers.get('Title')).toBe('x'.repeat(250));
  });

  it('does not throw when fetch returns non-ok (logs only)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('unauthorized'),
    } as Response);

    await expect(
      publishNtfyNotification({ title: 'T', message: 'M' })
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('does not throw when fetch rejects (logs only)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('network down'));

    await expect(
      publishNtfyNotification({ title: 'T', message: 'M' })
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
