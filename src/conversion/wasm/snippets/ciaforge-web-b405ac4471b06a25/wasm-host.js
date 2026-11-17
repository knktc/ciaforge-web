export async function readAt(host, offset, length) {
  return host.read(offset, length)
}

export async function writeAt(host, offset, bytes) {
  await host.write(offset, bytes)
}

export async function finish(host) {
  await host.finish()
}
