declare module 'wakeonlan' {
  interface WakeOnLanOptions {
    // Destination address, defaults to '255.255.255.255'
    address?: string
    // Number of packets to send, defaults to 3
    count?: number
    // Interval between packets in ms, defaults to 100
    interval?: number
    // Port to send to, defaults to 9
    port?: number
    // Source address for the socket, defaults to broadcast on all IPv4 interfaces
    from?: string
  }

  function wakeOnLan(mac: string, options?: WakeOnLanOptions): Promise<void>

  export = wakeOnLan
}
