export async function checkService() {
  try {
    const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
    return response.ok;
  } catch {
    return false;
  }
}
