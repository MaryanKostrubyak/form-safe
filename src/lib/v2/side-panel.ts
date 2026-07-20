export interface SidePanelOpener {
  open(options: { tabId: number }): Promise<void>;
}

export function openSidePanelForTab(
  sidePanel: SidePanelOpener | undefined,
  tabId: number | undefined,
): Promise<boolean> {
  if (!sidePanel || !Number.isInteger(tabId) || (tabId ?? -1) < 0) {
    return Promise.resolve(false);
  }

  try {
    return sidePanel.open({ tabId: tabId! }).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

export async function openSidePanelAndClosePopup(
  sidePanel: SidePanelOpener | undefined,
  tabId: number | undefined,
  closePopup: () => void,
): Promise<boolean> {
  const opened = await openSidePanelForTab(sidePanel, tabId);
  if (opened) closePopup();
  return opened;
}
