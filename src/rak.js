const { EventEmitter } = require('events')
const ConnWorker = require('./rakWorker')
const { waitFor } = require('./datatypes/util')
const { AdvertisementToString } = require('@sanctumterra/raknet')

let Client, Server, PacketPriority, EncapsulatedPacket, PacketReliability, Reliability
class RakTimeout extends Error {};

function setBackend (backend) {
  // We have to explicitly require the backend for bundlers
  switch (backend) {
    case 'raknet-node':
      ({ Client, Server, PacketPriority, PacketReliability } = require('raknet-node'))
      return { RakServer: RakNativeServer, RakClient: RakNativeClient, RakTimeout }
    case 'raknet-native':
      ({ Client, Server, PacketPriority, PacketReliability } = require('raknet-native'))
      return { RakServer: RakNativeServer, RakClient: RakNativeClient, RakTimeout }
    case 'jsp-raknet':
      ({ Client, Server, EncapsulatedPacket, Reliability } = require('jsp-raknet'))
      return { RakServer: RakJsServer, RakClient: RakJsClient, RakTimeout }
    case 'sanctumterra':
      ({ Client, Server, Reliability } = require('@sanctumterra/raknet'));
      EncapsulatedPacket = require('@sanctumterra/raknet').Frameset;
      PacketPriority = require('@sanctumterra/raknet').Priority;

      return { RakServer: RakSanctServer, RakClient: RakSanctClient, RakTimeout }
  }
}

module.exports = (backend) => {
  if (backend) {
    return setBackend(backend)
  } else {
    try {
      return setBackend('raknet-native')
    } catch (e) {
      console.debug(`[raknet] ${backend} library not found, defaulting to jsp-raknet. Correct the "raknetBackend" option to avoid this error.`, e)
      return setBackend('jsp-raknet')
    }
  }
}

class RakSanctClient extends EventEmitter {
  /**
   * @type {import("@sanctumterra/raknet").Client}
   */
  raknet;

  constructor (options, client) {
    super()
    this.connected = false

    this.onConnected = () => { }
    this.onCloseConnection = () => { }
    this.onEncapsulated = () => { }
    const protocolVersion = client?.versionGreaterThanOrEqualTo('1.19.30') ? 11 : 10
    const Logger = require("@sanctumterra/raknet").Logger;
    // Logger.disabled = true;

    /**
     * @type {import("@sanctumterra/raknet").Client}
     */
    const RakClient = Client;

    /**
     * @typedef {import("@sanctumterra/raknet").Client} Client
     */
    this.raknet = new RakClient({
      address: options.host,
      port: options.port,
      protocolVersion: protocolVersion,
      debug: false,
      timeout: 10000,
    })

    this.raknet.on('encapsulated', (buffer) => {
      if (this.connected) { // Discard packets that are queued to be sent to us after close
        const address = "127.0.0.1"
        this.onEncapsulated(buffer, address)
      }
    })

    this.raknet.on('connect', () => {
      this.connected = true
      this.onConnected()
    })

    this.raknet.on('close', () => {
      this.connected = false
      this.onCloseConnection('Raknet Closed')
    })
  }

  async ping (timeout = 1000) {
    return waitFor((done) => {
      this.raknet.ping().then((ping) => {
        done(AdvertisementToString(ping));
      }).catch((err) => {
        done(null);
      });
    }, timeout, () => {
      throw new RakTimeout('Ping timed out')
    })
  }

  connect () {
    this.raknet.connect()
  }

  close () {
    this.connected = false
    setTimeout(() => {
      this.raknet.cleanup()
    }, 40)
  }

  sendReliable (buffer, immediate) {
    if (!this.connected) return;
    const priority = immediate ? PacketPriority.IMMEDIATE_PRIORITY : PacketPriority.MEDIUM_PRIORITY
    return this.raknet.framer.frameAndSend(buffer, priority)
  }
}

class RakSanctServer extends EventEmitter {
   /**
   * @type {import("@sanctumterra/raknet").Server} raknet
   */
  raknet;

  constructor (options = {}, server) {
    super();
    this.onOpenConnection = () => { }
    this.onCloseConnection = () => { }
    this.onClose = () => {}

    this.onEncapsulated = (packet, conn) => server.onEncapsulated(packet, {
      ...conn.getAddress(),
      hash: `${conn.getAddress().address}/${conn.getAddress().port}`
    })

    this.raknet = new Server({
      host: options.host,
      port: options.port,
      maxConnections: options.maxPlayers || 3,
      protocol: server.versionLessThan('1.19.30') ? 10 : 11,
      motd: server.getAdvertisement().toBuffer(),
      maxPacketsPerSecond: 1000000
    });

    this.updateAdvertisement = () => {
      const ad = server.getAdvertisement();
      this.raknet.options.levelName = ad.levelName;
      this.raknet.options.motd = ad.motd;
      this.raknet.options.guid = BigInt(ad.serverId);
      this.raknet.options.version = ad.version;
      this.raknet.options.maxConnections = ad.playersMax;
    }

    this.raknet.on('connect', (conn) => {
      conn.connected = true;

      conn.sendReliable = (buffer, immediate) => {
        const priority = immediate ? 1 : 0;
        return conn.frameAndSend(buffer, priority);
      }
      conn.address = {
        ...conn.getAddress(),
        hash: `${conn.getAddress().address}/${conn.getAddress().port}`
      }

      conn.close = conn.disconnect;
      this.onOpenConnection(conn)
    });

    this.raknet.on("close", () => {
      this.onClose("Raknet Closed");
    });

    this.raknet.on('closeConnection', (client) => {
      this.onCloseConnection(client)
    })

    this.raknet.on("encapsulated", this.onEncapsulated);
  }

  listen() {
    this.raknet.start();
  }

  close() {
    this.raknet.close();
  }
}

class RakNativeClient extends EventEmitter {
  constructor (options, client) {
    super()
    this.connected = false
    this.onConnected = () => { }
    this.onCloseConnection = () => { }
    this.onEncapsulated = () => { }

    const protocolVersion = client?.versionGreaterThanOrEqualTo('1.19.30') ? 11 : 10
    this.raknet = new Client(options.host, options.port, { protocolVersion })
    this.raknet.on('encapsulated', ({ buffer, address }) => {
      if (this.connected) { // Discard packets that are queued to be sent to us after close
        this.onEncapsulated(buffer, address)
      }
    })

    this.raknet.on('connect', () => {
      this.connected = true
      this.onConnected()
    })

    this.raknet.on('disconnect', ({ reason }) => {
      this.connected = false
      this.onCloseConnection(reason)
    })
  }

  async ping (timeout = 1000) {
    this.raknet.ping()
    return waitFor((done) => {
      this.raknet.on('pong', (ret) => {
        if (ret.extra) {
          done(ret.extra.toString())
        }
      })
    }, timeout, () => {
      if ('REPLIT_ENVIRONMENT' in process.env) {
        console.warn('A Replit environment was detected. Replit may not support the necessary outbound UDP connections required to connect to a Minecraft server. Please see https://github.com/PrismarineJS/bedrock-protocol/blob/master/docs/FAQ.md for more information.')
      }
      throw new RakTimeout('Ping timed out')
    })
  }

  connect () {
    this.raknet.connect()
  }

  close () {
    this.connected = false
    setTimeout(() => {
      this.raknet.close()
    }, 40)
  }

  sendReliable (buffer, immediate) {
    if (!this.connected) return
    const priority = immediate ? PacketPriority.IMMEDIATE_PRIORITY : PacketPriority.MEDIUM_PRIORITY
    return this.raknet.send(buffer, priority, PacketReliability.RELIABLE_ORDERED, 0)
  }
}

class RakNativeServer extends EventEmitter {
  /**
   * @type {import("raknet-native").Server}
   */
  raknet;

  constructor (options = {}, server) {
    super()
    this.onOpenConnection = () => { }
    this.onCloseConnection = () => { }
    this.onEncapsulated = () => { }
    this.raknet = new Server(options.host, options.port, {
      maxConnections: options.maxPlayers || 3,
      protocolVersion: server.versionLessThan('1.19.30') ? 10 : 11,
      message: server.getAdvertisement().toBuffer()
    })
    this.onClose = () => {}

    this.updateAdvertisement = () => {
      this.raknet.setOfflineMessage(server.getAdvertisement().toBuffer())
    }

    this.raknet.on('openConnection', (client) => {
      client.sendReliable = function (buffer, immediate) {
        const priority = immediate ? PacketPriority.IMMEDIATE_PRIORITY : PacketPriority.MEDIUM_PRIORITY
        return this.send(buffer, priority, PacketReliability.RELIABLE_ORDERED, 0)
      }
      this.onOpenConnection(client)
    })

    this.raknet.on('closeConnection', (client) => {
      this.onCloseConnection(client)
    })

    this.raknet.on('encapsulated', ({ buffer, address }) => {
      this.onEncapsulated(buffer, address)
    })

    this.raknet.on('close', (reason) => this.onClose(reason))
  }

  listen () {
    this.raknet.listen()
  }

  close () {
    this.raknet.close()
  }
}

class RakJsClient extends EventEmitter {
  constructor (options = {}) {
    super()
    this.options = options
    this.onConnected = () => { }
    this.onCloseConnection = () => { }
    this.onEncapsulated = () => { }
    if (options.useWorkers) {
      this.connect = this.workerConnect
      this.close = reason => this.worker?.postMessage({ type: 'close', reason })
      this.sendReliable = this.workerSendReliable
    } else {
      this.connect = this.plainConnect
      this.close = reason => this.raknet.close(reason)
      this.sendReliable = this.plainSendReliable
    }
    this.pongCb = null
  }

  workerConnect (host = this.options.host, port = this.options.port) {
    this.worker = ConnWorker.connect(host, port)

    this.worker.on('message', (evt) => {
      switch (evt.type) {
        case 'connected': {
          this.onConnected()
          break
        }
        case 'encapsulated': {
          const [ecapsulated, address] = evt.args
          this.onEncapsulated(ecapsulated, address.hash)
          break
        }
        case 'pong':
          this.pongCb?.(evt.args)
          break
        case 'disconnect':
          this.onCloseConnection()
          break
      }
    })
  }

  async plainConnect (host = this.options.host, port = this.options.port) {
    this.raknet = new Client(host, port)
    await this.raknet.connect()

    this.raknet.on('connecting', () => {
      console.log(`[client] connecting to ${host}/${port}`)
    })

    this.raknet.on('connected', this.onConnected)
    this.raknet.on('encapsulated', (encapsulated, addr) => this.onEncapsulated(encapsulated, addr.hash))
    this.raknet.on('disconnect', (reason) => this.onCloseConnection(reason))
  }

  workerSendReliable (buffer, immediate) {
    this.worker.postMessage({ type: 'queueEncapsulated', packet: buffer, immediate })
  }

  plainSendReliable (buffer, immediate) {
    const sendPacket = new EncapsulatedPacket()
    sendPacket.reliability = Reliability.ReliableOrdered
    sendPacket.buffer = buffer
    this.raknet.connection.addEncapsulatedToQueue(sendPacket)
    if (immediate) this.raknet.connection.sendQueue()
  }

  async ping (timeout = 1000) {
    if (this.worker) {
      this.worker.postMessage({ type: 'ping' })
      return waitFor(res => {
        this.pongCb = data => res(data)
      }, timeout, () => { throw new RakTimeout('Ping timed out') })
    } else {
      if (!this.raknet) this.raknet = new Client(this.options.host, this.options.port)
      return waitFor(res => {
        this.raknet.ping(data => {
          this.raknet.close()
          res(data)
        })
      }, timeout, () => { throw new RakTimeout('Ping timed out') })
    }
  }
}

class RakJsServer extends EventEmitter {
  constructor (options = {}, server) {
    super()
    this.options = options
    this.server = server
    this.onOpenConnection = () => { }
    this.onCloseConnection = () => { }
    this.onEncapsulated = (packet, address) => server.onEncapsulated(packet.buffer, address)
    this.onClose = () => {}
    this.updateAdvertisement = () => {
      this.raknet.setPongAdvertisement(server.getAdvertisement())
    }
    if (options.useWorkers) {
      throw Error('nyi')
    } else {
      this.listen = this.plainListen
    }
  }

  async plainListen () {
    this.raknet = new Server(this.options.host, this.options.port, this.server.getAdvertisement())
    await this.raknet.listen(this.options.host, this.options.port)
    this.raknet.on('openConnection', (conn) => {
      conn.sendReliable = (buffer, immediate) => {
        const sendPacket = new EncapsulatedPacket()
        sendPacket.reliability = Reliability.ReliableOrdered
        sendPacket.buffer = buffer
        conn.addEncapsulatedToQueue(sendPacket, immediate ? 1 : 0)
      }
      this.onOpenConnection(conn)
    })
    this.raknet.on('closeConnection', this.onCloseConnection)
    this.raknet.on('encapsulated', this.onEncapsulated)
    this.raknet.on('close', this.onClose)
  }

  close () {
    // Allow some time for the final packets to come in/out
    setTimeout(() => {
      this.raknet.close()
    }, 40)
  }
}

