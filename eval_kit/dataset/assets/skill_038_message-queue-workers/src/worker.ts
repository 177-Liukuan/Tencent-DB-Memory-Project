export async function handle(message: { event_id: string; type: string }) {
  return { processed: message.event_id };
}
