import sodium from 'libsodium-wrappers-sumo';
let ready: Promise<typeof sodium> | undefined;
export function getSodium() {
  ready ??= sodium.ready.then(() => sodium);
  return ready;
}
