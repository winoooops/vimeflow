export const waitForE2eBridge = async (): Promise<void> => {
  await browser
    .waitUntil(
      async () =>
        await browser.execute(
          () => typeof window.__VIMEFLOW_E2E__ !== 'undefined'
        ),
      { timeout: 20_000, interval: 250 }
    )
    .catch(() => {
      throw new Error(
        'window.__VIMEFLOW_E2E__ missing - rebuild with VITE_E2E=1'
      )
    })
}
