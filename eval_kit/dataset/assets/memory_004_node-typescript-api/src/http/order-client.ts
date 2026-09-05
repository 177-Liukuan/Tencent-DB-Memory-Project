export async function requestOrder(url: string): Promise<unknown> {
  const response = await fetch(url);
  return response.json();
}
