import { RTCPeerConnection } from 'react-native-webrtc'
import TcpSocket from 'react-native-tcp-socket'
import * as Crypto from 'expo-crypto'
import { selectedPeerRoute, type PeerRoute } from './peer-route'
import {
  decode,
  peerRoom,
  peerCapability,
  peerDigest,
  peerSocketUrl,
  peerSignalSchema,
  peerReadySchema,
  signPeerSignal,
  verifyPeerSignal,
  validPeerRelay,
  openCustomRelay,
  PEER_STUN_URLS,
  PEER_CONNECTION_ERROR,
  PEER_DISCONNECT_GRACE_MS,
  createPeerPipe,
  createPeerHeartbeat,
  peerCandidateCounts,
  type PeerConfig,
  type PeerRelay,
} from '@dovo/protocol'

/** Native loopback keeps the existing HTTP, WebSocket, file and WebView paths on
 * the same encrypted data transport. It is bound only to the phone's loopback;
 * the computer's address/ports are never opened to the internet. */
export async function openPeerTunnel(
  config: PeerConfig,
  onClosed: () => void = () => {},
  abort?: AbortSignal,
  onRouteChanged: () => void = () => {},
) {
  const session = Array.from(await Crypto.getRandomBytesAsync(32), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  if (abort?.aborted) throw new Error('Internet connection was closed')
  const pc = new RTCPeerConnection({ iceServers: PEER_STUN_URLS.map((urls) => ({ urls })) })
  let ready: ReturnType<RTCPeerConnection['createDataChannel']>
  let signal: WebSocket
  try {
    ready = pc.createDataChannel('dovo-ready-v1', { ordered: true })
    signal = new WebSocket(peerSocketUrl(config))
  } catch (error) {
    pc.close()
    throw error
  }
  const pipes = new Set<ReturnType<typeof createPeerPipe>>()
  let stopped = false,
    connected = false
  let server: ReturnType<typeof TcpSocket.createServer> | undefined
  let relay: PeerRelay | undefined
  let relayUnavailable = false
  let expiry: ReturnType<typeof setTimeout> | undefined
  let disconnected: ReturnType<typeof setTimeout> | undefined
  let statsTimer: ReturnType<typeof setTimeout> | undefined
  let route: PeerRoute | undefined
  let readingStats = false
  let routeRevision = 0
  let stage = 'contacting Dovo Connect'
  const setRoute = (value: PeerRoute | undefined) => {
    if (stopped) return
    if (route === value) return
    route = value
    onRouteChanged()
  }
  const checkRoute = (value: PeerRoute | undefined) => {
    setRoute(value)
    if (value !== 'direct' && relay && relay.expiresAt <= Date.now() + 60000)
      close(new Error('Relay credentials expired. Reconnecting with fresh credentials.'))
  }
  const refreshRoute = async () => {
    if (stopped || readingStats || pc.connectionState !== 'connected') return
    clearTimeout(statsTimer)
    readingStats = true
    const revision = routeRevision
    try {
      const value = selectedPeerRoute(await pc.getStats())
      if (revision === routeRevision && pc.connectionState === 'connected') checkRoute(value)
    } catch {
      // Missing statistics leave the route unknown. An expiring relay still requires a fresh,
      // verified direct pair before we can safely keep the tunnel alive.
      if (revision === routeRevision && pc.connectionState === 'connected') checkRoute(undefined)
    } finally {
      readingStats = false
      // Native WebRTC has no selected-pair-change event. Track ICE changes while active.
      if (!stopped && pc.connectionState === 'connected') {
        // A report started before ICE recovery cannot describe its new selected pair.
        if (revision !== routeRevision) void refreshRoute()
        else statsTimer = setTimeout(() => void refreshRoute(), 5000)
      }
    }
  }
  let finishGathering: (() => void) | undefined
  let fail: (error: Error) => void = () => {}
  const closed = new Promise<never>((_, reject) => {
    fail = reject
  })
  // close() can run between awaited native operations, or after the tunnel opens.
  void closed.catch(() => {})
  const untilClosed = <T>(operation: Promise<T>) => Promise.race([operation, closed])
  let rejectBinding: ((error: Error) => void) | undefined
  const close = (cause?: unknown) => {
    if (stopped) return
    stopped = true
    abort?.removeEventListener('abort', close)
    clearTimeout(timeout)
    if (expiry) clearTimeout(expiry)
    if (disconnected) clearTimeout(disconnected)
    clearTimeout(statsTimer)
    heartbeat.stop()
    route = undefined
    finishGathering?.()
    for (const pipe of pipes) pipe.stop()
    server?.close()
    signal.close()
    pc.close()
    onClosed()
    const error =
      cause instanceof Error
        ? cause
        : new Error(
            relayUnavailable
              ? config.relay === 'custom'
                ? 'The configured relay is unavailable and a direct connection could not be established. Check the computer’s TURN settings or organization sign-in, then reconnect.'
                : 'Dovo relay is unavailable and a direct connection could not be established. Check that Dovo Connect is enabled and your account is signed in on both devices, then reconnect.'
              : PEER_CONNECTION_ERROR,
          )
    fail(error)
    rejectBinding?.(error)
    rejectBinding = undefined
  }
  const timeout = setTimeout(() => {
    if (relayUnavailable) {
      close()
      return
    }
    const candidates = peerCandidateCounts(pc.localDescription?.sdp ?? '')
    close(
      new Error(
        `${PEER_CONNECTION_ERROR} Setup timed out while ${stage}. Gathered candidates: ${candidates.host} local, ${candidates.srflx} STUN, ${candidates.relay} TURN.`,
      ),
    )
  }, 30000)
  const heartbeat = createPeerHeartbeat({
    send: (value) => ready.send(value),
    connected: () => pc.connectionState === 'connected',
    onTimeout: () =>
      close(new Error('Internet connection stopped responding. Reconnect to your computer.')),
  })
  // Only a computer advertising heartbeat support receives probes; older runtimes stay compatible.
  ready.addEventListener('message', (event) => {
    if (!heartbeat.receive(event.data)) close(new Error('Invalid connection health message'))
  })
  const established = new Promise<void>((resolve) => {
    ready.onopen = () => {
      connected = true
      resolve()
    }
    pc.onconnectionstatechange = () => {
      if (stopped) return
      routeRevision++
      if (pc.connectionState === 'disconnected') {
        clearTimeout(statsTimer)
        setRoute(undefined)
        // ICE can recover a temporary network interruption without replacing every
        // HTTP/WebSocket connection. Repeated events must not extend the deadline.
        disconnected ??= setTimeout(close, PEER_DISCONNECT_GRACE_MS)
      } else {
        if (pc.connectionState === 'connected') {
          if (disconnected) clearTimeout(disconnected)
          disconnected = undefined
          void refreshRoute()
        }
        if (['failed', 'closed'].includes(pc.connectionState)) close()
      }
    }
    ready.onclose = () => close()
    ready.onerror = () => close()
  })
  let offerHash = ''
  let accepted = false
  let brokerJoined = false
  const brokerReady = new Promise<void>((resolve, reject) => {
    signal.onopen = () => {
      if (stopped) return
      signal.send(
        JSON.stringify({
          type: 'client',
          room: peerRoom(config),
          key: peerCapability(config, 'client'),
          session,
          customRelaySupported: true,
          ...(config.relay ? { relay: config.relay } : {}),
        }),
      )
    }
    signal.onerror = () => {
      // Once the authenticated answer arrived, signaling no longer owns the tunnel.
      if (accepted || stopped) return
      reject(new Error('Could not reach Dovo Connect'))
      close()
    }
    signal.onclose = () => {
      if (!connected && !accepted) {
        reject(new Error('Computer is offline or internet access is no longer authorized'))
        close()
      }
    }
    signal.onmessage = (event) => {
      if (stopped) return
      try {
        const raw: unknown = event.data
        if (typeof raw !== 'string' || raw.length > 70 * 1024)
          throw new Error('Invalid signaling metadata')
        const value: unknown = JSON.parse(raw)
        if (value && typeof value === 'object' && 'type' in value && value.type === 'ready') {
          if (brokerJoined) throw new Error('Duplicate signaling readiness')
          brokerJoined = true
          const joined = decode(peerReadySchema, value)
          relay = joined.customRelay
            ? openCustomRelay(config, session, joined.customRelay)
            : joined.relay
          relayUnavailable = !!joined.relayUnavailable
          if (
            !joined.customRelay &&
            relay &&
            !validPeerRelay(relay, config.relay, Date.now(), config.relayHosts)
          )
            throw new Error('Relay was not enabled or its credentials have an invalid lifetime')
          resolve()
          return
        }
        const answer = decode(peerSignalSchema, value)
        if (
          accepted ||
          answer.session !== session ||
          answer.role !== 'answer' ||
          answer.offer !== offerHash ||
          answer.relay !== relay?.provider ||
          !verifyPeerSignal(config, answer)
        )
          throw new Error('Computer identity could not be verified')
        accepted = true
        stage = 'establishing the encrypted data connection'
        void pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp }).catch(() => close())
      } catch (error) {
        reject(error)
        close(error)
      }
    }
  })
  void brokerReady.catch(() => {})
  abort?.addEventListener('abort', close, { once: true })
  if (abort?.aborted) close()
  try {
    await untilClosed(brokerReady)
    if (stopped) throw new Error(PEER_CONNECTION_ERROR)
    pc.setConfiguration({
      iceServers: [...PEER_STUN_URLS.map((urls) => ({ urls })), ...(relay?.iceServers ?? [])],
      iceTransportPolicy: 'all',
    })
    stage = 'gathering STUN and TURN candidates'
    await untilClosed(pc.setLocalDescription())
    await untilClosed(
      new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve()
          return
        }
        // Keep already gathered host/IPv6 candidates useful even when one STUN service
        // is unreachable. The signed offer contains the candidates available now.
        const deadline = setTimeout(() => finishGathering?.(), relay ? 8000 : 4000)
        finishGathering = () => {
          clearTimeout(deadline)
          pc.onicegatheringstatechange = null
          finishGathering = undefined
          resolve()
        }
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') finishGathering?.()
        }
      }),
    )
    if (stopped) throw new Error(PEER_CONNECTION_ERROR)
    const sdp = pc.localDescription?.sdp
    if (!sdp) throw new Error('No local ICE description')
    offerHash = peerDigest(sdp)
    stage = 'waiting for the computer’s authenticated answer'
    signal.send(
      JSON.stringify(
        signPeerSignal(config, {
          role: 'offer',
          session,
          offer: offerHash,
          sdp,
          ...(relay ? { relay: relay.provider } : {}),
        }),
      ),
    )
    await untilClosed(established)
    stage = 'opening the local connection listener'
    signal.close()
    server = TcpSocket.createServer(
      { allowHalfOpen: true, pauseOnConnect: true, noDelay: true },
      (socket) => {
        if (stopped || pipes.size >= 32) {
          socket.destroy()
          return
        }
        let channel: ReturnType<RTCPeerConnection['createDataChannel']>
        try {
          channel = pc.createDataChannel('dovo-tcp-v1', { ordered: true })
        } catch (error) {
          // Native teardown can precede its JS state event. Fail the tunnel so the
          // request layer can recover, instead of throwing out of the socket callback.
          socket.destroy()
          close(error)
          return
        }
        channel.binaryType = 'arraybuffer'
        const pipe = createPeerPipe({
          stream: {
            onData: (f) => {
              socket.on('data', (bytes) => {
                if (typeof bytes === 'string') {
                  pipe.stop()
                  return
                }
                f(bytes)
              })
            },
            onEnd: (f) => {
              socket.on('end', f)
            },
            onClose: (f) => {
              socket.on('close', f)
            },
            onError: (f) => {
              socket.on('error', f)
            },
            write: (bytes, callback) => {
              socket.write(bytes, undefined, callback)
            },
            pause: () => {
              socket.pause()
            },
            resume: () => {
              socket.resume()
            },
            end: () => {
              socket.end()
            },
            destroy: () => {
              socket.destroy()
            },
          },
          send: (value) => {
            if (typeof value === 'string') channel.send(value)
            else channel.send(value)
          },
          close: () => channel.close(),
        })
        pipes.add(pipe)
        channel.onopen = () => pipe.ready()
        channel.onerror = () => pipe.stop()
        channel.onclose = () => {
          pipes.delete(pipe)
          pipe.stop()
        }
        channel.addEventListener('message', (event) => {
          const data: unknown = event.data
          if (typeof data === 'string') pipe.receive(data)
          else if (data instanceof ArrayBuffer) pipe.receive(new Uint8Array(data))
          else pipe.stop()
        })
        // Native creation is synchronous and can return an already-open channel.
        // Its open event may precede the JavaScript handlers being attached.
        if (channel.readyState === 'open') pipe.ready()
      },
    )
    const listener = server
    listener.on('error', close)
    await new Promise<void>((resolve, reject) => {
      if (stopped) {
        reject(new Error('Internet connection was closed'))
        return
      }
      rejectBinding = reject
      listener.once('error', reject)
      listener.listen({ port: 0, host: '127.0.0.1' }, () => {
        rejectBinding = undefined
        listener.removeListener('error', reject)
        // Native close() is a no-op before binding completes. A late native callback must
        // close the newly bound listener too, even though the peer is already stopped.
        if (stopped) {
          listener.close()
          reject(new Error('Internet connection was closed'))
          return
        }
        resolve()
      })
    })
    const address = listener.address()
    if (stopped || !address || !('port' in address)) throw new Error(PEER_CONNECTION_ERROR)
    clearTimeout(timeout)
    if (relay)
      expiry = setTimeout(
        () => {
          // A direct connection does not depend on TURN credentials. Recheck the selected
          // pair rather than interrupting working traffic merely because relay was offered.
          void refreshRoute()
        },
        Math.max(0, relay.expiresAt - Date.now() - 60000),
      )
    return {
      address: `http://127.0.0.1:${address.port}`,
      close,
      // Keep the shared tunnel during the bounded ICE recovery window.
      alive: () => !stopped && connected,
      route: () =>
        stopped
          ? undefined
          : route === 'relay' && relay?.provider === 'custom'
            ? ('custom' as const)
            : route,
    }
  } catch (error) {
    close()
    throw error
  }
}
