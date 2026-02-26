import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { Server } from "socket.io"
import { io as ioc } from "socket.io-client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ApiHttpError } from "../http/errors"
import { configurePluginNamespace } from "./plugin-namespace"

const validToken = "pat_validprefix_validSecret123"
const validUserId = "user-plugin-123"
const validDeviceUid = "device-uid-abc-456"
const validDeviceId = "device-db-id-789"

function createMockAuthenticate(options: { reject?: boolean } = {}) {
  return async (token: string) => {
    if (options.reject || token !== validToken) {
      throw new ApiHttpError("UNAUTHORIZED", { message: "Invalid personal access token" })
    }

    return {
      userId: validUserId,
      patId: "pat-id-1",
      tokenPrefix: "validprefix",
    }
  }
}

function createMockGetOrCreateDeviceId(options: { reject?: boolean } = {}) {
  return async (_args: { userId: string; deviceUid: string }) => {
    if (options.reject) {
      throw new Error("Device resolution failed")
    }

    return validDeviceId
  }
}

function startTestServer(io: Server): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const httpServer = createServer()
    io.attach(httpServer)
    httpServer.listen(0, "127.0.0.1", () => {
      const { port } = httpServer.address() as AddressInfo
      resolve({
        port,
        close: () =>
          new Promise((res) => {
            io.close(() => {
              httpServer.close(() => res())
            })
          }),
      })
    })
  })
}

describe("configurePluginNamespace", () => {
  let io: Server
  let port: number
  let closeServer: () => Promise<void>

  beforeEach(async () => {
    io = new Server({ transports: ["websocket"] })
    configurePluginNamespace(io, {
      authenticate: createMockAuthenticate(),
      getOrCreateDeviceId: createMockGetOrCreateDeviceId(),
    })
    const server = await startTestServer(io)
    port = server.port
    closeServer = server.close
  })

  afterEach(async () => {
    await closeServer()
  })

  it("accepts connection with valid PAT and device_uid, joins device:{deviceId} room", async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = ioc(`http://127.0.0.1:${port}/plugin`, {
        transports: ["websocket"],
        auth: { token: validToken, device_uid: validDeviceUid },
      })

      socket.on("connect", () => {
        const pluginNs = io.of("/plugin")
        const socketId = socket.id as string
        const rooms = pluginNs.sockets.get(socketId)?.rooms

        expect(rooms?.has(`device:${validDeviceId}`)).toBe(true)

        socket.disconnect()
        resolve()
      })

      socket.on("connect_error", (err) => {
        socket.disconnect()
        reject(err)
      })
    })
  })

  it("stores userId and deviceId in socket.data", async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = ioc(`http://127.0.0.1:${port}/plugin`, {
        transports: ["websocket"],
        auth: { token: validToken, device_uid: validDeviceUid },
      })

      socket.on("connect", () => {
        const pluginNs = io.of("/plugin")
        const socketId = socket.id as string
        const serverSocket = pluginNs.sockets.get(socketId)

        expect(serverSocket?.data.userId).toBe(validUserId)
        expect(serverSocket?.data.deviceId).toBe(validDeviceId)

        socket.disconnect()
        resolve()
      })

      socket.on("connect_error", (err) => {
        socket.disconnect()
        reject(err)
      })
    })
  })

  it("rejects connection when token is missing", async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = ioc(`http://127.0.0.1:${port}/plugin`, {
        transports: ["websocket"],
        auth: { device_uid: validDeviceUid },
        // no token
      })

      socket.on("connect", () => {
        socket.disconnect()
        reject(new Error("Expected connection to be rejected"))
      })

      socket.on("connect_error", (err) => {
        expect(err.message).toBe("UNAUTHORIZED")
        socket.disconnect()
        resolve()
      })
    })
  })

  it("rejects connection when device_uid is missing", async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = ioc(`http://127.0.0.1:${port}/plugin`, {
        transports: ["websocket"],
        auth: { token: validToken },
        // no device_uid
      })

      socket.on("connect", () => {
        socket.disconnect()
        reject(new Error("Expected connection to be rejected"))
      })

      socket.on("connect_error", (err) => {
        expect(err.message).toBe("INVALID_PAYLOAD")
        socket.disconnect()
        resolve()
      })
    })
  })

  it("rejects connection when PAT is invalid", async () => {
    await new Promise<void>((resolve, reject) => {
      const socket = ioc(`http://127.0.0.1:${port}/plugin`, {
        transports: ["websocket"],
        auth: { token: "pat_wrong_token", device_uid: validDeviceUid },
      })

      socket.on("connect", () => {
        socket.disconnect()
        reject(new Error("Expected connection to be rejected"))
      })

      socket.on("connect_error", (err) => {
        expect(err.message).toBe("UNAUTHORIZED")
        socket.disconnect()
        resolve()
      })
    })
  })

  it("rejects connection when authenticate throws", async () => {
    await closeServer()

    const failingIo = new Server({ transports: ["websocket"] })
    configurePluginNamespace(failingIo, {
      authenticate: createMockAuthenticate({ reject: true }),
      getOrCreateDeviceId: createMockGetOrCreateDeviceId(),
    })
    const server = await startTestServer(failingIo)
    closeServer = server.close

    await new Promise<void>((resolve, reject) => {
      const socket = ioc(`http://127.0.0.1:${server.port}/plugin`, {
        transports: ["websocket"],
        auth: { token: validToken, device_uid: validDeviceUid },
      })

      socket.on("connect", () => {
        socket.disconnect()
        reject(new Error("Expected connection to be rejected"))
      })

      socket.on("connect_error", (err) => {
        expect(err.message).toBe("UNAUTHORIZED")
        socket.disconnect()
        resolve()
      })
    })
  })

  it("rejects connection when device resolution throws", async () => {
    await closeServer()

    const failingIo = new Server({ transports: ["websocket"] })
    configurePluginNamespace(failingIo, {
      authenticate: createMockAuthenticate(),
      getOrCreateDeviceId: createMockGetOrCreateDeviceId({ reject: true }),
    })
    const server = await startTestServer(failingIo)
    closeServer = server.close

    await new Promise<void>((resolve, reject) => {
      const socket = ioc(`http://127.0.0.1:${server.port}/plugin`, {
        transports: ["websocket"],
        auth: { token: validToken, device_uid: validDeviceUid },
      })

      socket.on("connect", () => {
        socket.disconnect()
        reject(new Error("Expected connection to be rejected"))
      })

      socket.on("connect_error", (err) => {
        expect(err.message).toBe("UNAUTHORIZED")
        socket.disconnect()
        resolve()
      })
    })
  })
})
