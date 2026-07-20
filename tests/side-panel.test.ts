import { describe, expect, it, vi } from 'vitest';
import {
  openSidePanelAndClosePopup,
  openSidePanelForTab,
} from '../src/lib/v2/side-panel';

describe('openSidePanelForTab', () => {
  it('opens the panel directly for the already resolved tab', async () => {
    const open = vi.fn().mockResolvedValue(undefined);

    const result = openSidePanelForTab({ open }, 42);

    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith({ tabId: 42 });
    await expect(result).resolves.toBe(true);
  });

  it('does not try to open without a valid tab id', async () => {
    const open = vi.fn().mockResolvedValue(undefined);

    await expect(openSidePanelForTab({ open }, undefined)).resolves.toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('returns false when Chrome rejects the side panel request', async () => {
    const open = vi.fn().mockRejectedValue(new Error('User gesture required'));

    await expect(openSidePanelForTab({ open }, 42)).resolves.toBe(false);
  });

  it('handles a synchronous Chrome API failure', async () => {
    const open = vi.fn(() => {
      throw new Error('Side panel is unavailable');
    });

    await expect(openSidePanelForTab({ open }, 42)).resolves.toBe(false);
  });
});

describe('openSidePanelAndClosePopup', () => {
  it('closes the popup after the side panel opens', async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    const closePopup = vi.fn();

    await expect(
      openSidePanelAndClosePopup({ open }, 42, closePopup),
    ).resolves.toBe(true);

    expect(closePopup).toHaveBeenCalledOnce();
  });

  it('waits for Chrome to confirm the panel before closing the popup', async () => {
    let confirmOpen!: () => void;
    const open = vi.fn(
      () => new Promise<void>((resolve) => {
        confirmOpen = resolve;
      }),
    );
    const closePopup = vi.fn();

    const result = openSidePanelAndClosePopup({ open }, 42, closePopup);
    expect(closePopup).not.toHaveBeenCalled();

    confirmOpen();
    await expect(result).resolves.toBe(true);
    expect(closePopup).toHaveBeenCalledOnce();
  });

  it('keeps the popup open so an error can be shown when opening fails', async () => {
    const open = vi.fn().mockRejectedValue(new Error('Unavailable'));
    const closePopup = vi.fn();

    await expect(
      openSidePanelAndClosePopup({ open }, 42, closePopup),
    ).resolves.toBe(false);

    expect(closePopup).not.toHaveBeenCalled();
  });
});
