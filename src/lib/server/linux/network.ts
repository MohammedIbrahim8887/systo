import { run } from "../exec";

/**
 * Per-process network traffic. Linux has no unprivileged counter per process, but the kernel
 * keeps byte totals for every TCP socket and `ss` reports them with the owning pid, so traffic
 * is the growth of each socket between two readings.
 *
 * TCP only: UDP sockets carry no byte counters, so QUIC (HTTP/3) and most VPN tunnels show up in
 * the system totals but not against a process. Sockets of other users' processes are listed
 * without a pid and are skipped.
 */

interface SocketBytes {
  pid: number;
  in: number;
  out: number;
}

let previous: Map<string, SocketBytes> | null = null;

const LOOPBACK = /^(127\.|\[::1\]|\[::ffff:127\.)/;

/** One `ss -tinpO` line per socket: state, queues, local, peer, users:(("name",pid=N,fd=N)), then TCP info. */
export function parseSockets(text: string): Map<string, SocketBytes> {
  const sockets = new Map<string, SocketBytes>();
  for (const line of text.split("\n")) {
    const pid = /users:\(\("[^"]*",pid=(\d+),/.exec(line)?.[1];
    if (!pid) continue;
    const cells = line.trim().split(/\s+/);
    const local = cells[3];
    const peer = cells[4];
    if (!local || !peer || LOOPBACK.test(peer)) continue;
    sockets.set(`${pid} ${local} ${peer}`, {
      pid: Number(pid),
      in: Number(/\bbytes_received:(\d+)/.exec(line)?.[1] ?? 0),
      out: Number(/\bbytes_sent:(\d+)/.exec(line)?.[1] ?? 0),
    });
  }
  return sockets;
}

/** Bytes received and sent per pid since the previous call. The first call only takes the baseline. */
export async function socketTraffic(): Promise<Map<number, { in: number; out: number }> | null> {
  const { stdout, code } = await run("ss", ["-H", "-t", "-i", "-n", "-p", "-O"], 4000);
  if (code !== 0) return null;
  const sockets = parseSockets(stdout);
  const moved = new Map<number, { in: number; out: number }>();
  if (previous) {
    for (const [key, now] of sockets) {
      // A socket opened since the last reading counts in full.
      const before = previous.get(key);
      const received = Math.max(0, now.in - (before?.in ?? 0));
      const sent = Math.max(0, now.out - (before?.out ?? 0));
      if (!received && !sent) continue;
      const total = moved.get(now.pid) ?? { in: 0, out: 0 };
      total.in += received;
      total.out += sent;
      moved.set(now.pid, total);
    }
  }
  previous = sockets;
  return moved;
}
